import type { SupabaseClient } from '@supabase/supabase-js';

import { convertJourneyItemToDeal } from '@/lib/deals/convert-journey-item';
import type { DealEventSource } from '@/lib/deals/events';
import {
  prepareDealStageMove,
  syncPropertyStatus,
  type BrokerageCapture,
} from '@/lib/deals/stage-move';
import { writeJourneyEvent } from '@/lib/journey/events';
import {
  dealStatusForStage,
  needsBrokerageCapture,
} from '@/lib/pipelines/stage-semantics';
import type { JourneyEventType, JourneyStageKind } from '@/types';

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type JourneyMoveEventType = Extract<
  JourneyEventType,
  'advanced' | 'moved'
>;

export function parseJourneyMoveInput(raw: unknown): ParseResult<{
  itemId: string;
  stageId: string;
  eventType: JourneyMoveEventType;
}> {
  if (!raw || typeof raw !== 'object')
    return { ok: false, error: 'item_id and stage_id are required' };
  const input = raw as Record<string, unknown>;
  const itemId = typeof input.item_id === 'string' ? input.item_id.trim() : '';
  const stageId =
    typeof input.stage_id === 'string' ? input.stage_id.trim() : '';
  if (!itemId || !stageId)
    return { ok: false, error: 'item_id and stage_id are required' };
  const eventType: JourneyMoveEventType =
    input.event_type === 'advanced' ? 'advanced' : 'moved';
  return { ok: true, value: { itemId, stageId, eventType } };
}

export interface JourneyMoveInput {
  itemId: string;
  stageId: string;
  eventType: JourneyMoveEventType;
  brokerage: BrokerageCapture | null;
  /** A surface that cannot prompt (a WhatsApp reply) moves without
   *  the brokerage; the record still opens and can be priced later. */
  requireBrokerage: boolean;
  reason?: string | null;
  source: DealEventSource;
}

export type JourneyMoveResult =
  | {
      ok: true;
      itemId: string;
      stageId: string;
      stageName: string;
      dealId: string | null;
    }
  | {
      ok: false;
      status: number;
      error: string;
      code?: string;
      data?: { stage_name: string; deal_value: number };
    };

const one = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

/**
 * Move a journey item to a stage. When the stage mirrors a pipeline
 * stage, the item's deal follows through the same stage-move logic as
 * the board (brokerage, closing record, property status), and a move
 * into a closing or won stage opens the deal on that very stage. A deal
 * on another pipeline stays where it is: the mirror only reflects the
 * default board.
 */
export async function moveJourneyItem(
  ctx: { supabase: SupabaseClient; accountId: string; userId: string },
  input: JourneyMoveInput
): Promise<JourneyMoveResult> {
  const { supabase, accountId, userId } = ctx;

  const [{ data: item }, { data: targetRow }] = await Promise.all([
    supabase
      .from('journey_items')
      .select('id, property_id, stage_id, property:properties(price)')
      .eq('id', input.itemId)
      .eq('account_id', accountId)
      .maybeSingle(),
    supabase
      .from('journey_stages')
      .select(
        'id, name, stage_kind, pipeline_stage_id, pipeline_stage:pipeline_stages(id, pipeline_id)'
      )
      .eq('id', input.stageId)
      .eq('account_id', accountId)
      .maybeSingle(),
  ]);
  if (!item) {
    return { ok: false, status: 404, error: 'Journey item not found' };
  }
  if (!targetRow) {
    return { ok: false, status: 404, error: 'Stage not found' };
  }
  const target = {
    ...targetRow,
    stage_kind: targetRow.stage_kind as JourneyStageKind,
    pipeline_stage: one(targetRow.pipeline_stage),
  };
  const property = one(item.property);

  const { data: deal } = await supabase
    .from('deals')
    .select('id, value, brokerage_amount, property_id, pipeline_id')
    .eq('account_id', accountId)
    .eq('source_journey_item_id', item.id)
    .maybeSingle();

  const opensRecord =
    target.stage_kind === 'closing' || target.stage_kind === 'won';
  const targetPipelineId = target.pipeline_stage?.pipeline_id ?? null;
  const dealFollows = Boolean(
    target.pipeline_stage_id &&
    deal &&
    targetPipelineId &&
    deal.pipeline_id === targetPipelineId
  );
  const dealOpens = Boolean(target.pipeline_stage_id && !deal && opensRecord);

  if (
    (dealFollows || dealOpens) &&
    input.requireBrokerage &&
    !input.brokerage &&
    needsBrokerageCapture(deal ?? { brokerage_amount: null }, target.name)
  ) {
    return {
      ok: false,
      status: 409,
      error: `Record the brokerage before moving to ${target.name}`,
      code: 'BROKERAGE_REQUIRED',
      data: {
        stage_name: target.name,
        deal_value: Number(deal?.value ?? property?.price ?? 0) || 0,
      },
    };
  }

  // What must exist before either side moves is written first: the
  // brokerage and the closing record for a converted item, or the deal
  // itself (on the target stage) for a fresh conversion. The journey
  // item's own update then moves a converted deal through the trigger
  // in the same statement, so the two sides never part; a freshly
  // opened deal is removed again if that update fails.
  let dealId: string | null = deal?.id ?? null;
  let openedDealId: string | null = null;
  const dealMove =
    dealFollows && deal && target.pipeline_stage_id
      ? {
          dealId: deal.id,
          status: dealStatusForStage(target.name),
          targetStageId: target.pipeline_stage_id,
          stageName: target.name,
          propertyId: deal.property_id ?? item.property_id,
          brokerage: input.brokerage,
          source: input.source,
        }
      : null;
  if (dealMove) {
    const prepared = await prepareDealStageMove(ctx, dealMove);
    if (!prepared.ok) return prepared;
  } else if (dealOpens && target.pipeline_stage_id) {
    const result = await convertJourneyItemToDeal(ctx, {
      itemId: item.id,
      pipelineId: targetPipelineId,
      stageId: target.pipeline_stage_id,
      title: null,
      brokerage: input.brokerage,
      source: input.source,
    });
    if (!result.ok) {
      return { ok: false, status: result.status, error: result.error };
    }
    dealId = result.id;
    if (!result.existing) openedDealId = result.id;
  }

  const { data: moved, error: moveError } = await supabase
    .from('journey_items')
    .update({
      stage_id: target.id,
      status: 'active',
      drop_reason: null,
      dropped_at: null,
      planned_stage_id: null,
      planned_at: null,
    })
    .eq('id', item.id)
    .eq('account_id', accountId)
    .select('id');
  if (moveError || !moved?.length) {
    if (openedDealId) {
      const { data: removed } = await supabase
        .from('deals')
        .delete()
        .eq('id', openedDealId)
        .eq('account_id', accountId)
        .select('id');
      if (!removed?.length) {
        console.error(
          '[journey/move] Opened deal not removed after a failed item move:',
          openedDealId
        );
      }
    }
    return {
      ok: false,
      status: moveError ? 500 : 404,
      error: moveError?.message ?? 'That item is no longer there',
    };
  }
  await writeJourneyEvent({
    db: supabase,
    accountId,
    itemId: item.id,
    eventType: input.eventType,
    createdBy: userId,
    fromStageId: item.stage_id,
    toStageId: target.id,
    reason: input.reason ?? null,
  });
  if (dealMove) await syncPropertyStatus(ctx, dealMove);

  return {
    ok: true,
    itemId: item.id,
    stageId: target.id,
    stageName: target.name,
    dealId,
  };
}
