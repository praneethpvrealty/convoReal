// ============================================================
// Wallet bootstrap — safety net for account-creation paths that
// bypass handle_new_user()'s wallet bootstrap (migration 088), e.g.
// remove_account_member's "spin up a fresh personal account" branch.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { billingAdmin } from '@/lib/billing/admin-client';
import type { CreditWallet } from './types';

function generateReferralCode(seed: string): string {
  const clean = seed.replace(/[^a-zA-Z]/g, '').toUpperCase();
  const prefix = (clean + 'XXXX').slice(0, 4);
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return prefix + suffix;
}

/**
 * Idempotent get-or-create for a credit wallet. Every credit-engine
 * entry point (grant/burn/referral) calls this first so an account
 * created via a path that doesn't run handle_new_user()'s wallet
 * bootstrap still works.
 */
export async function getOrCreateWallet(
  accountId: string,
  // Accepted for call-site compatibility but intentionally ignored: wallet
  // bootstrap must run as service-role to bypass RLS on credit_wallets.
  // Callers therefore must only pass a server-trusted accountId, never
  // user-supplied input, since RLS no longer scopes this to one account.
  client?: SupabaseClient,
): Promise<CreditWallet> {
  const supabase = billingAdmin();
  if (client) {
    // Suppress lint warning for unused parameter while preserving signature compatibility
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('credit_wallets')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  if (fetchErr) {
    throw new Error(`[getOrCreateWallet] fetch failed: ${fetchErr.message}`);
  }

  let wallet = existing as CreditWallet | null;

  if (!wallet) {
    // Insert with ON CONFLICT DO NOTHING semantics via upsert, then
    // re-select — avoids a race if two calls create concurrently.
    const referralCode = generateReferralCode(accountId);
    const { error: insertErr } = await supabase
      .from('credit_wallets')
      .upsert(
        { account_id: accountId, referral_code: referralCode },
        { onConflict: 'account_id', ignoreDuplicates: true },
      );

    if (insertErr) {
      throw new Error(`[getOrCreateWallet] insert failed: ${insertErr.message}`);
    }

    const { data: created, error: reselectErr } = await supabase
      .from('credit_wallets')
      .select('*')
      .eq('account_id', accountId)
      .single();

    if (reselectErr || !created) {
      throw new Error(`[getOrCreateWallet] reselect failed: ${reselectErr?.message ?? 'no row'}`);
    }

    wallet = created as CreditWallet;
  }

  // Lazy credit reset check for Starter plan:
  // If the wallet reset time is null or in the past, and they are on the starter plan,
  // we reset their monthly credits to 100, and set next monthly reset.
  const now = new Date();
  if (!wallet.monthly_reset_at || new Date(wallet.monthly_reset_at) <= now) {
    // Fetch plan limits to determine plan
    const { data: limits } = await supabase
      .from('account_plan_limits')
      .select('plan')
      .eq('account_id', accountId)
      .maybeSingle();

    if (limits?.plan === 'starter' || !limits) {
      const nextReset = new Date();
      nextReset.setMonth(nextReset.getMonth() + 1);

      const { error: rpcErr } = await supabase.rpc('grant_subscription_credits_tx', {
        p_account_id: accountId,
        p_monthly_amount: 100,
        p_bonus_delta: 0,
        p_reset_at: nextReset.toISOString(),
      });

      if (!rpcErr) {
        // Re-fetch the updated wallet
        const { data: updatedWallet } = await supabase
          .from('credit_wallets')
          .select('*')
          .eq('account_id', accountId)
          .single();
        if (updatedWallet) {
          wallet = updatedWallet as CreditWallet;
        }
      } else {
        console.error('[getOrCreateWallet] Lazy reset failed:', rpcErr);
      }
    }
  }

  return wallet;
}
