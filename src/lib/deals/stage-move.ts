import type { SupabaseClient } from '@supabase/supabase-js';

import { ensureClosingRecord } from '@/lib/deals/closing-record';
import type { DealEventSource } from '@/lib/deals/events';
import { actorName } from '@/lib/deals/server';
import { brokerageAmount, type BrokerageType } from '@/lib/pipelines/brokerage';
import { propertyStatusForPipelineStage } from '@/lib/pipelines/stage-semantics';

export type DealStatus = 'open' | 'won' | 'lost';

export interface BrokerageCapture {
  brokerage_type: BrokerageType;
  brokerage_value: number;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const BROKERAGE_INPUT_ERROR =
  "'brokerage_type' must be 'percentage' or 'fixed' with a positive 'brokerage_value'";

export function parseBrokerageCapture(
  raw: Record<string, unknown>
): ParseResult<BrokerageCapture | null> {
  const { brokerage_type, brokerage_value } = raw;
  if (brokerage_type === undefined && brokerage_value === undefined) {
    return { ok: true, value: null };
  }
  if (
    (brokerage_type !== 'percentage' && brokerage_type !== 'fixed') ||
    typeof brokerage_value !== 'number' ||
    !Number.isFinite(brokerage_value) ||
    brokerage_value <= 0
  ) {
    return { ok: false, error: BROKERAGE_INPUT_ERROR };
  }
  return { ok: true, value: { brokerage_type, brokerage_value } };
}

export function brokerageColumns(
  dealValue: number | string | null | undefined,
  brokerage: BrokerageCapture
) {
  return {
    brokerage_type: brokerage.brokerage_type,
    brokerage_value: brokerage.brokerage_value,
    brokerage_amount: brokerageAmount({
      dealValue,
      type: brokerage.brokerage_type,
      value: brokerage.brokerage_value,
    }),
  };
}

export interface DealStageMoveInput {
  dealId: string;
  status: DealStatus;
  targetStageId: string | null;
  stageName: string | null;
  propertyId: string | null;
  brokerage: BrokerageCapture | null;
  source: DealEventSource;
}

export type DealStageMoveResult =
  { ok: true } | { ok: false; status: number; error: string; code?: string };

export type DealStageMoveContext = {
  supabase: SupabaseClient;
  accountId: string;
  userId: string;
};

/**
 * Everything a stage move records besides the stage itself, written
 * before the stage changes: the brokerage columns and the closing
 * record. Both are idempotent, so a move that then fails leaves a deal
 * that is merely prepared, never one that moved without its record.
 */
export async function prepareDealStageMove(
  ctx: DealStageMoveContext,
  input: DealStageMoveInput
): Promise<DealStageMoveResult> {
  const { supabase, accountId, userId } = ctx;

  if (input.brokerage) {
    const { data: current } = await supabase
      .from('deals')
      .select('value')
      .eq('id', input.dealId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!current) {
      return { ok: false, status: 404, error: 'Deal not found' };
    }
    const { data: priced, error: priceErr } = await supabase
      .from('deals')
      .update(brokerageColumns(current.value, input.brokerage))
      .eq('id', input.dealId)
      .eq('account_id', accountId)
      .select('id');
    if (priceErr || !priced?.length) {
      return {
        ok: false,
        status: priceErr ? 500 : 404,
        error: priceErr?.message ?? 'Deal not found',
      };
    }
  }

  if (input.targetStageId && input.stageName) {
    const record = await ensureClosingRecord({
      db: supabase,
      accountId,
      dealId: input.dealId,
      stageName: input.stageName,
      actorId: userId,
      actorName: await actorName(supabase, accountId, userId),
      source: input.source,
    });
    if (record.error) {
      return {
        ok: false,
        status: 500,
        error: `The closing record could not be started, so the deal was not moved: ${record.error}`,
        code: 'CLOSING_RECORD_FAILED',
      };
    }
  }

  return { ok: true };
}

export async function syncPropertyStatus(
  ctx: Pick<DealStageMoveContext, 'supabase' | 'accountId'>,
  input: Pick<DealStageMoveInput, 'propertyId' | 'stageName' | 'status'>
): Promise<void> {
  if (!input.propertyId) return;
  const propertyStatus = input.stageName
    ? (propertyStatusForPipelineStage(input.stageName) ?? 'Available')
    : input.status === 'won'
      ? 'Sold'
      : 'Available';
  const { data: synced } = await ctx.supabase
    .from('properties')
    .update({ status: propertyStatus })
    .eq('id', input.propertyId)
    .eq('account_id', ctx.accountId)
    .select('id');
  if (!synced?.length) {
    console.warn(
      '[deals/stage-move] Property status not synced:',
      input.propertyId
    );
  }
}

export async function applyDealStageMove(
  ctx: DealStageMoveContext,
  input: DealStageMoveInput
): Promise<DealStageMoveResult> {
  const { supabase, accountId } = ctx;

  const prepared = await prepareDealStageMove(ctx, input);
  if (!prepared.ok) return prepared;

  const updateData: Record<string, unknown> = { status: input.status };
  if (input.targetStageId) updateData.stage_id = input.targetStageId;
  const { data: updated, error: updateErr } = await supabase
    .from('deals')
    .update(updateData)
    .eq('id', input.dealId)
    .eq('account_id', accountId)
    .select('id');
  if (!updateErr && !updated?.length) {
    return { ok: false, status: 404, error: 'Deal not found' };
  }
  if (updateErr) {
    console.error('[deals/stage-move] Update error:', updateErr);
    return {
      ok: false,
      status: 500,
      error: updateErr.message ?? 'Failed to update deal status',
    };
  }

  await syncPropertyStatus(ctx, input);
  return { ok: true };
}
