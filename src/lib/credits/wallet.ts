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
  client?: SupabaseClient,
): Promise<CreditWallet> {
  const supabase = billingAdmin();

  const { data: existing, error: fetchErr } = await supabase
    .from('credit_wallets')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  if (fetchErr) {
    throw new Error(`[getOrCreateWallet] fetch failed: ${fetchErr.message}`);
  }
  if (existing) return existing as CreditWallet;

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

  return created as CreditWallet;
}
