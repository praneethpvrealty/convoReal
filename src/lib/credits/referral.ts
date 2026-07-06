// ============================================================
// Referral engine — signup, 7-day activation, plan-upgrade
// conversion, monthly passive earn.
//
// Referrer signup reward (200cr) is credited immediately into the
// pending_referral_credits bucket (visible, not spendable) and
// promoted to spendable referral_credits only after the referee's
// 7-day activation window confirms the signup is legitimate. If the
// referral is later marked invalid before that, the pending amount
// is voided and the referrer is notified.
//
// Plan-upgrade rewards (500/1500/4000cr) are paid instantly and
// spendably on conversion — real payment already occurred, no
// pending state needed.
// ============================================================

import { billingAdmin } from '@/lib/billing/admin-client';
import { getOrCreateWallet } from './wallet';
import { notifyManagerReferralConverted, notifyReferrerPendingVoided } from './notify';
import {
  REFERRAL_SIGNUP_BONUS,
  PLAN_CONVERSION_BONUS,
  MONTHLY_GRANT,
  recomputeReferralTier,
  referralTierMultiplier,
  type SubscriptionPlanForCredits,
  type Referral,
} from './types';

const ACTIVATION_WINDOW_DAYS = 7;
const PASSIVE_EARN_MONTHS_MAX = 12;

/**
 * Called right after a new account signs up with a referral code
 * (either from `?ref=CODE` captured at signup, or resolved from
 * accounts.referred_by_code as a reconciliation fallback).
 *
 * Idempotent on referee_account_id (UNIQUE constraint on referrals).
 */
export async function processReferralSignup(
  refereeAccountId: string,
  referralCode: string,
): Promise<{ created: boolean; reason?: string }> {
  const supabase = billingAdmin();

  const { data: referrerWallet } = await supabase
    .from('credit_wallets')
    .select('account_id')
    .eq('referral_code', referralCode)
    .maybeSingle();

  if (!referrerWallet) {
    return { created: false, reason: 'Referral code not found' };
  }

  const referrerAccountId = referrerWallet.account_id as string;
  if (referrerAccountId === refereeAccountId) {
    return { created: false, reason: 'Self-referral is not allowed' };
  }

  const { data: existing } = await supabase
    .from('referrals')
    .select('id')
    .eq('referee_account_id', refereeAccountId)
    .maybeSingle();
  if (existing) {
    return { created: false, reason: 'Account already has a referral source' };
  }

  // "Phone verified" here means the referee has a captured phone
  // number, the same bar as the rest of this WhatsApp CRM's signup
  // flow — there's no separate OTP verification step in this
  // codebase today.
  const { data: refereeProfile } = await supabase
    .from('profiles')
    .select('phone')
    .eq('account_id', refereeAccountId)
    .eq('org_role', 'org_manager')
    .maybeSingle();
  const phoneVerified = Boolean(refereeProfile?.phone);

  const { error: insertErr } = await supabase.from('referrals').insert({
    referrer_account_id: referrerAccountId,
    referee_account_id: refereeAccountId,
    status: 'pending',
    referee_phone_verified: phoneVerified,
  });

  if (insertErr) {
    throw new Error(`[processReferralSignup] insert failed: ${insertErr.message}`);
  }

  await getOrCreateWallet(refereeAccountId, supabase);

  // Referee gets their welcome bonus instantly and spendably.
  await supabase.rpc('grant_referral_credits_tx', {
    p_account_id: refereeAccountId,
    p_amount: REFERRAL_SIGNUP_BONUS,
    p_type: 'referral_signup',
    p_related_account_id: referrerAccountId,
    p_description: 'Welcome bonus for signing up via a referral link',
    p_expires_at: null,
  });

  // Referrer's reward lands as pending — visible immediately, spendable
  // only after the 7-day activation window.
  await supabase.rpc('grant_pending_referral_tx', {
    p_account_id: referrerAccountId,
    p_amount: REFERRAL_SIGNUP_BONUS,
    p_related_account_id: refereeAccountId,
    p_description: 'Referral signup reward (pending 7-day activation)',
  });

  return { created: true };
}

/**
 * Reconciliation step: signup only captures `accounts.referred_by_code`
 * (via the handle_new_user() trigger, migration 088) — there's no
 * active session yet at signup time to call an authed API route and
 * create the actual `referrals` row. This finds any account with a
 * captured code that hasn't been processed into a referrals row yet
 * and processes it. Called at the start of the activation cron.
 */
export async function processUnclaimedReferralSignups(): Promise<{ processed: number; checked: number }> {
  const supabase = billingAdmin();

  const { data: candidates, error } = await supabase
    .from('accounts')
    .select('id, referred_by_code')
    .not('referred_by_code', 'is', null);

  if (error) throw new Error(`[processUnclaimedReferralSignups] fetch failed: ${error.message}`);
  if (!candidates || candidates.length === 0) return { processed: 0, checked: 0 };

  let processed = 0;
  for (const account of candidates) {
    const { data: existing } = await supabase
      .from('referrals')
      .select('id')
      .eq('referee_account_id', account.id)
      .maybeSingle();
    if (existing) continue;

    const result = await processReferralSignup(account.id, account.referred_by_code as string);
    if (result.created) processed += 1;
  }

  return { processed, checked: candidates.length };
}

/** Promotes one referral's pending reward to spendable after its
 *  7-day activation window is confirmed. */
export async function activateReferral(referral: Referral): Promise<void> {
  const supabase = billingAdmin();

  const { error: promoteErr } = await supabase.rpc('promote_pending_referral_tx', {
    p_account_id: referral.referrer_account_id,
    p_amount: REFERRAL_SIGNUP_BONUS,
    p_related_account_id: referral.referee_account_id,
  });
  if (promoteErr) {
    throw new Error(`[activateReferral] promote failed: ${promoteErr.message}`);
  }

  const { error: updateErr } = await supabase
    .from('referrals')
    .update({ status: 'active', activated_at: new Date().toISOString() })
    .eq('id', referral.id);
  if (updateErr) {
    throw new Error(`[activateReferral] status update failed: ${updateErr.message}`);
  }
}

/**
 * Batch job for the 7-day activation cron. A referral activates when
 * it's been pending for >= 7 days AND the referee has logged in at
 * least once since signing up (proxy for "remained active" per the
 * abuse-prevention rule).
 */
export async function activatePendingReferrals(): Promise<{ activated: number; checked: number }> {
  const supabase = billingAdmin();
  const cutoff = new Date(Date.now() - ACTIVATION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates, error } = await supabase
    .from('referrals')
    .select('*')
    .eq('status', 'pending')
    .lte('signed_up_at', cutoff);

  if (error) throw new Error(`[activatePendingReferrals] fetch failed: ${error.message}`);
  if (!candidates || candidates.length === 0) return { activated: 0, checked: 0 };

  let activated = 0;
  for (const referral of candidates as Referral[]) {
    const { data: refereeProfile } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('account_id', referral.referee_account_id)
      .eq('org_role', 'org_manager')
      .maybeSingle();

    if (!refereeProfile?.user_id) continue;

    const { data: authUser } = await supabase.auth.admin.getUserById(refereeProfile.user_id);
    const lastSignIn = authUser?.user?.last_sign_in_at;
    const hasLoggedInSinceSignup =
      Boolean(lastSignIn) && new Date(lastSignIn!) >= new Date(referral.signed_up_at);

    if (hasLoggedInSinceSignup) {
      await activateReferral(referral);
      activated += 1;
    }
  }

  return { activated, checked: candidates.length };
}

/** Called when a referral is confirmed as abuse before activation —
 *  voids the pending reward and notifies the referrer. */
export async function voidPendingReferral(referral: Referral, reason: string): Promise<void> {
  const supabase = billingAdmin();

  const { error: voidErr } = await supabase.rpc('void_pending_referral_tx', {
    p_account_id: referral.referrer_account_id,
    p_amount: REFERRAL_SIGNUP_BONUS,
    p_related_account_id: referral.referee_account_id,
    p_reason: reason,
  });
  if (voidErr) {
    throw new Error(`[voidPendingReferral] void failed: ${voidErr.message}`);
  }

  const { error: updateErr } = await supabase.from('referrals').update({ status: 'invalid' }).eq('id', referral.id);
  if (updateErr) {
    throw new Error(`[voidPendingReferral] status update failed: ${updateErr.message}`);
  }

  await notifyReferrerPendingVoided(referral.referrer_account_id, reason);
}

/**
 * Called when a referee's subscription plan changes to a paid tier
 * (billing upgrade route + subscription.activated webhook branch).
 * Grants the referrer their conversion bonus instantly and
 * spendably, recomputes their referral tier.
 */
export async function processReferralConversion(
  refereeAccountId: string,
  newPlan: SubscriptionPlanForCredits,
): Promise<void> {
  const supabase = billingAdmin();

  const { data: referral } = await supabase
    .from('referrals')
    .select('*')
    .eq('referee_account_id', refereeAccountId)
    .in('status', ['pending', 'active'])
    .maybeSingle();

  if (!referral) return; // no referral source for this account, nothing to do

  const bonus = PLAN_CONVERSION_BONUS[newPlan];
  const passiveEarnExpiresAt = new Date();
  passiveEarnExpiresAt.setMonth(passiveEarnExpiresAt.getMonth() + PASSIVE_EARN_MONTHS_MAX);

  const { data: wallet } = await supabase
    .from('credit_wallets')
    .select('paid_referral_count')
    .eq('account_id', referral.referrer_account_id)
    .single();

  const newPaidCount = (wallet?.paid_referral_count ?? 0) + 1;
  const newTier = recomputeReferralTier(newPaidCount);
  const multiplier = referralTierMultiplier(newTier);
  const grantedAmount = Math.round(bonus * multiplier);

  await supabase.rpc('grant_referral_credits_tx', {
    p_account_id: referral.referrer_account_id,
    p_amount: grantedAmount,
    p_type: 'referral_upgrade',
    p_related_account_id: refereeAccountId,
    p_description: `Referral conversion bonus — referee upgraded to ${newPlan}`,
    p_expires_at: null,
  });

  await supabase
    .from('credit_wallets')
    .update({ paid_referral_count: newPaidCount, referral_tier: newTier })
    .eq('account_id', referral.referrer_account_id);

  await supabase
    .from('referrals')
    .update({
      status: 'converted',
      converted_at: new Date().toISOString(),
      referee_plan: newPlan,
      passive_earn_expires_at: passiveEarnExpiresAt.toISOString(),
    })
    .eq('id', referral.id);

  const { data: refereeProfile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('account_id', refereeAccountId)
    .eq('org_role', 'org_manager')
    .maybeSingle();

  void notifyManagerReferralConverted(
    referral.referrer_account_id,
    refereeProfile?.full_name ?? 'Your referral',
    grantedAmount,
  );
}

/** Monthly cron: pays 10% of the referee's monthly grant, times the
 *  referrer's tier multiplier, for up to 12 months post-conversion.
 *  Idempotent via passive_earn_months check. */
export async function payoutPassiveEarn(referral: Referral): Promise<{ paid: boolean }> {
  if (referral.passive_earn_months >= PASSIVE_EARN_MONTHS_MAX) return { paid: false };
  if (referral.passive_earn_expires_at && new Date(referral.passive_earn_expires_at) < new Date()) {
    return { paid: false };
  }
  if (!referral.referee_plan || !(referral.referee_plan in MONTHLY_GRANT)) return { paid: false };

  const supabase = billingAdmin();
  const { data: wallet } = await supabase
    .from('credit_wallets')
    .select('referral_tier')
    .eq('account_id', referral.referrer_account_id)
    .single();

  const tier = wallet?.referral_tier ?? 'bronze';
  const monthlyGrant = MONTHLY_GRANT[referral.referee_plan as SubscriptionPlanForCredits];
  const amount = Math.round(monthlyGrant * 0.1 * referralTierMultiplier(tier));

  await supabase.rpc('grant_referral_credits_tx', {
    p_account_id: referral.referrer_account_id,
    p_amount: amount,
    p_type: 'referral_passive',
    p_related_account_id: referral.referee_account_id,
    p_description: `Passive referral earnings — month ${referral.passive_earn_months + 1}`,
    p_expires_at: null,
  });

  await supabase
    .from('referrals')
    .update({ passive_earn_months: referral.passive_earn_months + 1 })
    .eq('id', referral.id);

  return { paid: true };
}

/** Batch job for the monthly passive-earn cron. */
export async function payoutPassiveEarnAll(): Promise<{ paid: number; checked: number }> {
  const supabase = billingAdmin();
  const now = new Date().toISOString();

  const { data: candidates, error } = await supabase
    .from('referrals')
    .select('*')
    .eq('status', 'converted')
    .lt('passive_earn_months', PASSIVE_EARN_MONTHS_MAX)
    .or(`passive_earn_expires_at.is.null,passive_earn_expires_at.gt.${now}`);

  if (error) throw new Error(`[payoutPassiveEarnAll] fetch failed: ${error.message}`);
  if (!candidates || candidates.length === 0) return { paid: 0, checked: 0 };

  let paid = 0;
  for (const referral of candidates as Referral[]) {
    const result = await payoutPassiveEarn(referral);
    if (result.paid) paid += 1;
  }

  return { paid, checked: candidates.length };
}
