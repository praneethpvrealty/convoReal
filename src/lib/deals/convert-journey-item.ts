import type { AccountContext } from '@/lib/auth/account';
import {
  buildConversionDeal,
  defaultStageForConversion,
  type ConvertibleJourneyItem,
} from '@/lib/deals/conversion';
import { writeDealEvent, type DealEventSource } from '@/lib/deals/events';
import { standardMilestoneRows } from '@/lib/deals/milestones';
import { actorName } from '@/lib/deals/server';
import {
  brokerageColumns,
  type BrokerageCapture,
} from '@/lib/deals/stage-move';
import { writeJourneyEvent } from '@/lib/journey/events';
import {
  DEFAULT_PIPELINE_NAME,
  SPEC_DEFAULT_STAGES,
} from '@/lib/pipelines/default-stages';
import {
  dealStatusForStage,
  propertyStatusForPipelineStage,
} from '@/lib/pipelines/stage-semantics';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { JourneyStageKind } from '@/types';

export interface ConvertJourneyItemInput {
  itemId: string;
  pipelineId: string | null;
  /** Land on this stage of the pipeline instead of the conversion
   *  default. A journey move onto a mirrored stage names its own. */
  stageId?: string | null;
  title: string | null;
  brokerage?: BrokerageCapture | null;
  source: DealEventSource;
}

export type ConvertJourneyItemResult =
  | { ok: true; status: 200 | 201; id: string; existing: boolean }
  | { ok: false; status: number; error: string };

type JourneyStageRef = {
  id: string;
  name: string;
  stage_kind: JourneyStageKind;
};
type ItemRow = Omit<ConvertibleJourneyItem, 'contact' | 'property'> & {
  contact:
    ConvertibleJourneyItem['contact'] | ConvertibleJourneyItem['contact'][];
  property:
    ConvertibleJourneyItem['property'] | ConvertibleJourneyItem['property'][];
  stage: JourneyStageRef | JourneyStageRef[] | null;
};
const one = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

/**
 * Open the closing record for a journey item. Idempotent per item: a
 * second call returns the deal that already exists rather than a
 * duplicate. Shared by the convert route and a journey move that
 * lands on a closing or won stage.
 */
export async function convertJourneyItemToDeal(
  ctx: Pick<AccountContext, 'supabase' | 'accountId' | 'userId'>,
  input: ConvertJourneyItemInput
): Promise<ConvertJourneyItemResult> {
  const { itemId, pipelineId, title, source } = input;

  const { data: existing } = await ctx.supabase
    .from('deals')
    .select('id')
    .eq('account_id', ctx.accountId)
    .eq('source_journey_item_id', itemId)
    .maybeSingle();
  if (existing?.id) {
    return { ok: true, status: 200, id: existing.id, existing: true };
  }

  const { data: itemRow, error: itemError } = await ctx.supabase
    .from('journey_items')
    .select(
      'id, contact_id, property_id, stage_id, status, ' +
        'contact:contacts(name, phone), ' +
        'property:properties(title, unit_no, price), ' +
        'stage:journey_stages!journey_items_stage_id_fkey(id, name, stage_kind)'
    )
    .eq('id', itemId)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (itemError) {
    return { ok: false, status: 500, error: 'Failed to load journey item' };
  }
  if (!itemRow) {
    return { ok: false, status: 404, error: 'Journey item not found' };
  }

  const raw = itemRow as unknown as ItemRow;
  const item: ConvertibleJourneyItem = {
    ...raw,
    contact: one(raw.contact),
    property: one(raw.property),
  };
  const journeyStage = one(raw.stage);

  let resolvedPipelineId = pipelineId;
  if (!resolvedPipelineId) {
    const { data: pipelines } = await ctx.supabase
      .from('pipelines')
      .select('id')
      .eq('account_id', ctx.accountId)
      .order('created_at')
      .limit(1);
    resolvedPipelineId = pipelines?.[0]?.id ?? null;
  }
  if (!resolvedPipelineId) {
    // Creating a board is an admin write under RLS, but an agent
    // converting the account's first deal should not be blocked on
    // it. The seed runs service-role, pinned to the caller's own
    // account, and creates exactly the default board the pipelines
    // page would.
    const admin = supabaseAdmin();
    const { data: pipeline, error: pipelineError } = await admin
      .from('pipelines')
      .insert({
        user_id: ctx.userId,
        account_id: ctx.accountId,
        name: DEFAULT_PIPELINE_NAME,
      })
      .select('id')
      .single();
    if (pipelineError || !pipeline) {
      return {
        ok: false,
        status: 500,
        error: 'Could not create a pipeline for this deal',
      };
    }
    const { error: stagesError } = await admin.from('pipeline_stages').insert(
      SPEC_DEFAULT_STAGES.map((s) => ({
        pipeline_id: pipeline.id,
        name: s.name,
        color: s.color,
        position: s.position,
      }))
    );
    if (stagesError) {
      return {
        ok: false,
        status: 500,
        error: 'Could not create the pipeline stages for this deal',
      };
    }
    resolvedPipelineId = pipeline.id;
  }
  if (!resolvedPipelineId) {
    return {
      ok: false,
      status: 500,
      error: 'Could not resolve a pipeline for this deal',
    };
  }
  const pipelineIdResolved: string = resolvedPipelineId;
  const { data: stages } = await ctx.supabase
    .from('pipeline_stages')
    .select('id, name, position')
    .eq('pipeline_id', pipelineIdResolved)
    .order('position');
  const stage = input.stageId
    ? ((stages ?? []).find((s) => s.id === input.stageId) ?? null)
    : defaultStageForConversion(
        stages ?? [],
        journeyStage?.stage_kind ?? 'prospecting'
      );
  if (!stage) {
    return {
      ok: false,
      status: 409,
      error: input.stageId
        ? 'That stage is not on the pipeline this deal would open on'
        : 'That pipeline has no active stage to open a deal on',
    };
  }

  const row = {
    ...buildConversionDeal({
      item,
      accountId: ctx.accountId,
      userId: ctx.userId,
      pipelineId: pipelineIdResolved,
      stageId: stage.id,
      title,
    }),
    status: dealStatusForStage(stage.name),
  };
  const insertRow = input.brokerage
    ? { ...row, ...brokerageColumns(row.value, input.brokerage) }
    : row;

  const { data: deal, error: dealError } = await ctx.supabase
    .from('deals')
    .insert(insertRow)
    .select('id')
    .single();
  if (dealError || !deal) {
    // The unique index on source_journey_item_id turns a race into
    // the idempotent answer rather than a second deal.
    if (dealError?.code === '23505') {
      const { data: raced } = await ctx.supabase
        .from('deals')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('source_journey_item_id', itemId)
        .maybeSingle();
      if (raced?.id) {
        return { ok: true, status: 200, id: raced.id, existing: true };
      }
    }
    return {
      ok: false,
      status: 500,
      error: dealError?.message ?? 'Could not create the deal',
    };
  }

  const name = await actorName(ctx.supabase, ctx.accountId, ctx.userId);

  await ctx.supabase
    .from('deal_milestones')
    .insert(standardMilestoneRows(ctx.accountId, deal.id));

  await writeDealEvent({
    db: ctx.supabase,
    accountId: ctx.accountId,
    dealId: deal.id,
    eventType: 'converted_from_journey',
    title: journeyStage
      ? `Converted from journey at ${journeyStage.name}`
      : 'Converted from journey',
    actorId: ctx.userId,
    actorName: name,
    source,
    metadata: {
      journey_item_id: item.id,
      journey_stage_id: journeyStage?.id ?? null,
      journey_stage_name: journeyStage?.name ?? null,
      journey_stage_kind: journeyStage?.stage_kind ?? null,
      contact_id: item.contact_id,
      property_id: item.property_id,
      pipeline_id: pipelineIdResolved,
      stage_id: stage.id,
      stage_name: stage.name,
    },
    dedupeKey: `convert:${item.id}`,
  });

  // Best-effort: the journey side of the hand-off needs the widened
  // CHECK from migration 20260918010100. The deal is the record.
  const journeyOutcome = await writeJourneyEvent({
    db: ctx.supabase,
    accountId: ctx.accountId,
    itemId: item.id,
    eventType: 'converted_to_deal',
    createdBy: ctx.userId,
    dedupeKey: `deal:${deal.id}`,
    metadata: { deal_id: deal.id, deal_title: row.title },
  });
  if (!journeyOutcome.ok) {
    console.warn(
      '[convert-to-deal] journey event not written:',
      journeyOutcome.error
    );
  }

  const propertyStatus = propertyStatusForPipelineStage(stage.name);
  if (propertyStatus && propertyStatus !== 'Available') {
    const { data: synced } = await ctx.supabase
      .from('properties')
      .update({ status: propertyStatus })
      .eq('id', item.property_id)
      .eq('account_id', ctx.accountId)
      .select('id');
    // The deal is already open; a listing that did not follow is a
    // line in the log, not a failed conversion.
    if (!synced?.length) {
      console.warn(
        '[convert-to-deal] Property status not synced:',
        item.property_id
      );
    }
  }

  return { ok: true, status: 201, id: deal.id, existing: false };
}
