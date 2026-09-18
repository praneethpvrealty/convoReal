import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  buildConversionDeal,
  defaultStageForConversion,
  parseConversionInput,
  type ConvertibleJourneyItem,
} from '@/lib/deals/conversion';
import { writeDealEvent } from '@/lib/deals/events';
import { standardMilestoneRows } from '@/lib/deals/milestones';
import { actorName } from '@/lib/deals/server';
import { writeJourneyEvent } from '@/lib/journey/events';
import {
  DEFAULT_PIPELINE_NAME,
  SPEC_DEFAULT_STAGES,
} from '@/lib/pipelines/default-stages';
import { propertyStatusForPipelineStage } from '@/lib/pipelines/stage-semantics';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import type { JourneyStageKind } from '@/types';

// POST /api/journey/convert-to-deal — open the closing record for a
// journey item. Idempotent per item: a second call returns the deal
// that already exists rather than a duplicate.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const limit = await checkRateLimit(
      `agent:convertJourney:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const parsed = parseConversionInput(await request.json().catch(() => null));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { itemId, pipelineId, title, source } = parsed.value;

    const { data: existing } = await ctx.supabase
      .from('deals')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('source_journey_item_id', itemId)
      .maybeSingle();
    if (existing?.id) {
      return NextResponse.json({ data: { id: existing.id, existing: true } });
    }

    const { data: itemRow, error: itemError } = await ctx.supabase
      .from('journey_items')
      .select(
        'id, contact_id, property_id, stage_id, status, ' +
          'contact:contacts(name, phone), ' +
          'property:properties(title, unit_no, price), ' +
          'stage:journey_stages(id, name, stage_kind)'
      )
      .eq('id', itemId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (itemError) {
      return NextResponse.json(
        { error: 'Failed to load journey item' },
        { status: 500 }
      );
    }
    if (!itemRow) {
      return NextResponse.json(
        { error: 'Journey item not found' },
        { status: 404 }
      );
    }

    type JourneyStageRef = { id: string; name: string; stage_kind: JourneyStageKind };
    type ItemRow = Omit<ConvertibleJourneyItem, 'contact' | 'property'> & {
      contact: ConvertibleJourneyItem['contact'] | ConvertibleJourneyItem['contact'][];
      property: ConvertibleJourneyItem['property'] | ConvertibleJourneyItem['property'][];
      stage: JourneyStageRef | JourneyStageRef[] | null;
    };
    const one = <T,>(v: T | T[] | null | undefined): T | null =>
      Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
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
      const { data: pipeline, error: pipelineError } = await ctx.supabase
        .from('pipelines')
        .insert({
          user_id: ctx.userId,
          account_id: ctx.accountId,
          name: DEFAULT_PIPELINE_NAME,
        })
        .select('id')
        .single();
      if (pipelineError || !pipeline) {
        return NextResponse.json(
          { error: 'Could not create a pipeline for this deal' },
          { status: 500 }
        );
      }
      await ctx.supabase.from('pipeline_stages').insert(
        SPEC_DEFAULT_STAGES.map((s) => ({
          pipeline_id: pipeline.id,
          name: s.name,
          color: s.color,
          position: s.position,
        }))
      );
      resolvedPipelineId = pipeline.id;
    }

    if (!resolvedPipelineId) {
      return NextResponse.json(
        { error: 'Could not resolve a pipeline for this deal' },
        { status: 500 }
      );
    }
    const pipelineIdResolved: string = resolvedPipelineId;
    const { data: stages } = await ctx.supabase
      .from('pipeline_stages')
      .select('id, name, position')
      .eq('pipeline_id', pipelineIdResolved)
      .order('position');
    const stage = defaultStageForConversion(
      stages ?? [],
      journeyStage?.stage_kind ?? 'prospecting'
    );
    if (!stage) {
      return NextResponse.json(
        { error: 'That pipeline has no stages' },
        { status: 409 }
      );
    }

    const row = buildConversionDeal({
      item,
      accountId: ctx.accountId,
      userId: ctx.userId,
      pipelineId: pipelineIdResolved,
      stageId: stage.id,
      title,
    });

    const { data: deal, error: dealError } = await ctx.supabase
      .from('deals')
      .insert(row)
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
          return NextResponse.json({ data: { id: raced.id, existing: true } });
        }
      }
      return NextResponse.json(
        { error: dealError?.message ?? 'Could not create the deal' },
        { status: 500 }
      );
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

    return NextResponse.json(
      { data: { id: deal.id, existing: false } },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
