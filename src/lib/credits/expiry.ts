// ============================================================
// Bucket expiry sweep — daily cron.
//
// Monthly credits expire via the reset in grantSubscriptionCredits
// (the reset IS the expiry, no separate job needed). Commitment
// bonus expires at the end of the committed term, also handled by
// the next grant call zeroing it out on non-renewal.
//
// This job handles the buckets with a fixed expires_at written at
// grant time: referral, promo, admin_grant. Reuses credit_transactions
// as the source of truth rather than a separate expiry-tracking table.
// ============================================================

import { billingAdmin } from '@/lib/billing/admin-client';
import type { CreditTransaction } from './types';

const EXPIRING_TYPES = ['referral_signup', 'referral_upgrade', 'referral_passive', 'promo', 'admin_grant'] as const;

/**
 * Finds unexpired grant transactions whose expires_at has passed and
 * haven't yet been offset by a matching 'expiry' transaction, deducts
 * the sum from the relevant bucket, and inserts an 'expiry' ledger row.
 */
export async function expireStaleCredits(): Promise<{ accountsProcessed: number; totalExpired: number }> {
  const supabase = billingAdmin();
  const now = new Date().toISOString();

  const { data: staleTx, error } = await supabase
    .from('credit_transactions')
    .select('*')
    .in('type', EXPIRING_TYPES)
    .not('expires_at', 'is', null)
    .lt('expires_at', now)
    .gt('amount', 0);

  if (error) throw new Error(`[expireStaleCredits] fetch failed: ${error.message}`);
  if (!staleTx || staleTx.length === 0) return { accountsProcessed: 0, totalExpired: 0 };

  // Already-expired transactions have a matching 'expiry' row
  // referencing them via description — check per-account bucket
  // totals against the wallet rather than tracking per-tx offset,
  // since this codebase has no per-transaction "offset" flag.
  const byAccountAndBucket = new Map<string, { accountId: string; bucket: string; amount: number }>();
  for (const tx of staleTx as CreditTransaction[]) {
    const key = `${tx.account_id}:${tx.bucket}`;
    const existing = byAccountAndBucket.get(key);
    byAccountAndBucket.set(key, {
      accountId: tx.account_id,
      bucket: tx.bucket,
      amount: (existing?.amount ?? 0) + tx.amount,
    });
  }

  let totalExpired = 0;
  const processedAccounts = new Set<string>();

  for (const { accountId, bucket, amount } of byAccountAndBucket.values()) {
    if (bucket !== 'referral' && bucket !== 'promo' && bucket !== 'bonus') continue;

    const { data: alreadyExpired } = await supabase
      .from('credit_transactions')
      .select('amount')
      .eq('account_id', accountId)
      .eq('bucket', bucket)
      .eq('type', 'expiry');

    const alreadyExpiredAmount = (alreadyExpired ?? []).reduce((sum, row) => sum + Math.abs(row.amount), 0);
    const outstandingToExpire = amount - alreadyExpiredAmount;
    if (outstandingToExpire <= 0) continue;

    const { data: wallet } = await supabase
      .from('credit_wallets')
      .select('monthly_credits, bonus_credits, referral_credits, purchased_credits, promo_credits')
      .eq('account_id', accountId)
      .single();
    if (!wallet) continue;

    const currentBucketValue = wallet[`${bucket}_credits` as keyof typeof wallet] as number;
    const deduction = Math.min(outstandingToExpire, currentBucketValue);
    if (deduction <= 0) continue;

    const newBucketValue = currentBucketValue - deduction;
    const newTotal =
      wallet.monthly_credits +
      wallet.purchased_credits +
      (bucket === 'bonus' ? newBucketValue : wallet.bonus_credits) +
      (bucket === 'referral' ? newBucketValue : wallet.referral_credits) +
      (bucket === 'promo' ? newBucketValue : wallet.promo_credits);

    await supabase
      .from('credit_wallets')
      .update({ [`${bucket}_credits`]: newBucketValue, total_credits: newTotal })
      .eq('account_id', accountId);

    await supabase.from('credit_transactions').insert({
      account_id: accountId,
      type: 'expiry',
      bucket,
      amount: -deduction,
      balance_after: newTotal,
      description: `${deduction.toLocaleString()} cr expired from ${bucket} bucket`,
    });

    totalExpired += deduction;
    processedAccounts.add(accountId);
  }

  return { accountsProcessed: processedAccounts.size, totalExpired };
}
