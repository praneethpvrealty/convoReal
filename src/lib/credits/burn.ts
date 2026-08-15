// ============================================================
// Credit burn — deduct credits for an AI feature call.
//
// Must be called BEFORE the external AI API call, never after
// (source design doc's explicit rule).
//
// Service-role only, by design: migration 263 revoked EXECUTE on both
// RPCs from anon and authenticated, so an RLS-scoped client fails with
// "permission denied for function burn_credits_tx". Do not re-add a
// client option — callers must resolve the account id server-side.
// ============================================================

import { billingAdmin } from '@/lib/billing/admin-client';
import { getOrCreateWallet } from './wallet';
import type { BillableFeatureKey } from './types';

export interface BurnResult {
  success: boolean;
  balanceAfter: number;
  /** How many credits short the account was. 0 when fully covered. */
  deficit: number;
}

export interface BurnOptions {
  /**
   * true (default): if the balance is insufficient, nothing is
   * deducted and `success: false` is returned — the caller must
   * abort the AI call and surface an error (402).
   *
   * false (soft-block): always deducts whatever is available (down
   * to 0 across all buckets) and returns `success: true` regardless,
   * so the caller proceeds with the AI call no matter what. Used
   * only by the WhatsApp chatbot's soft-burn path — inbound message
   * automation must never be blocked by a credit shortfall.
   */
  hardBlock?: boolean;
  /** Idempotency key for retries (e.g. webhook redelivery) — a retry
   *  within 60s of the same key is free. */
  retryKey?: string;
}

/**
 * Deducts `cost` credits for `feature`, bucket priority:
 * monthly -> bonus -> referral -> purchased -> promo.
 */
export async function burnCredits(
  accountId: string,
  feature: BillableFeatureKey,
  cost: number,
  opts: BurnOptions = {},
): Promise<BurnResult> {
  const hardBlock = opts.hardBlock ?? true;
  const supabase = billingAdmin();

  // Ensure the wallet exists before attempting the RPC — accounts
  // created outside the normal signup trigger may not have one yet.
  await getOrCreateWallet(accountId);

  const { data, error } = await supabase.rpc('burn_credits_tx', {
    p_account_id: accountId,
    p_feature: feature,
    p_cost: cost,
    p_hard_block: hardBlock,
    p_retry_key: opts.retryKey ?? null,
  });

  if (error) {
    throw new Error(`[burnCredits] RPC failed: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    success: Boolean(row?.success),
    balanceAfter: Number(row?.balance_after ?? 0),
    deficit: Number(row?.deficit ?? 0),
  };
}

/**
 * Refunds `cost` credits for `feature` using refund_credits_tx.
 * Reverses the burn across the original buckets.
 */
export async function refundCredits(
  accountId: string,
  feature: BillableFeatureKey,
  cost: number,
  opts: { description?: string } = {},
): Promise<{ success: boolean; balanceAfter: number }> {
  const supabase = billingAdmin();
  const description = opts.description ?? `${feature} refund`;

  const { data, error } = await supabase.rpc('refund_credits_tx', {
    p_account_id: accountId,
    p_feature: feature,
    p_cost: cost,
    p_description: description,
  });

  if (error) {
    throw new Error(`[refundCredits] RPC failed: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const balanceAfter = typeof row === 'number' ? row : Number(row?.balance_after ?? 0);

  return {
    success: true,
    balanceAfter,
  };
}
