// ============================================================
// Subscription credit grants — monthly reset + commitment bonus.
// Called from the Razorpay subscription webhook on
// `subscription.activated` / `subscription.charged`.
// ============================================================

import { billingAdmin } from '@/lib/billing/admin-client';
import { getOrCreateWallet } from './wallet';
import { notifyManagerCreditsAdded } from './notify';
import {
  MONTHLY_GRANT,
  COMMITMENT_BONUS_PCT,
  CYCLE_MONTHS,
  type SubscriptionPlanForCredits,
  type BillingCycleForCredits,
  type CreditPackage,
  type CreditPackagePrice,
  type PaymentGateway,
} from './types';

export interface GrantSubscriptionOptions {
  /** true only on subscription.activated, or on subscription.charged
   *  when a new committed term just started — never on a plain
   *  monthly renewal within an existing term. Controls whether the
   *  commitment bonus is (re-)applied. */
  isNewCycle: boolean;
  periodEnd: string;
}

/**
 * Resets the monthly bucket to the plan's value ("use it or lose
 * it") and, for multi-month committed cycles, tops up the bonus
 * bucket with the one-time commitment bonus for the full term.
 */
export async function grantSubscriptionCredits(
  accountId: string,
  plan: SubscriptionPlanForCredits,
  cycle: BillingCycleForCredits,
  opts: GrantSubscriptionOptions,
): Promise<void> {
  const supabase = billingAdmin();
  await getOrCreateWallet(accountId, supabase);

  const monthlyAmount = MONTHLY_GRANT[plan];
  let bonusDelta = 0;

  if (opts.isNewCycle && cycle !== 'monthly') {
    const totalTermCredits = monthlyAmount * CYCLE_MONTHS[cycle];
    bonusDelta = Math.round(totalTermCredits * COMMITMENT_BONUS_PCT[cycle]);
  }

  const { error } = await supabase.rpc('grant_subscription_credits_tx', {
    p_account_id: accountId,
    p_monthly_amount: monthlyAmount,
    p_bonus_delta: bonusDelta,
    p_reset_at: opts.periodEnd,
  });

  if (error) {
    throw new Error(`[grantSubscriptionCredits] RPC failed: ${error.message}`);
  }
}

export interface CreditPurchaseInput {
  accountId: string;
  packageKey: string;
  gateway: PaymentGateway;
  gatewayOrderId: string;
  gatewayPaymentId: string;
  /** Currency the purchase was made in — used only to look up the
   *  matching price row for logging/validation, the credited amount
   *  always comes from credit_packages.credits regardless. */
  currency: string;
}

/**
 * Shared by both the Razorpay and Stripe top-up webhooks. Looks up
 * the package, checks for an existing transaction with the same
 * gateway_order_id (idempotency — webhook redelivery must not
 * double-credit), then adds purchased_credits and inserts the ledger
 * row.
 */
export async function creditPurchase(
  input: CreditPurchaseInput,
): Promise<{ credited: boolean; credits: number }> {
  const supabase = billingAdmin();

  const { data: existingTx } = await supabase
    .from('credit_transactions')
    .select('id')
    .eq('gateway_order_id', input.gatewayOrderId)
    .maybeSingle();

  if (existingTx) {
    return { credited: false, credits: 0 };
  }

  const { data: pkg, error: pkgErr } = await supabase
    .from('credit_packages')
    .select('*')
    .eq('key', input.packageKey)
    .maybeSingle();

  if (pkgErr || !pkg) {
    throw new Error(`[creditPurchase] package not found: ${input.packageKey}`);
  }

  const creditPackage = pkg as CreditPackage;
  await getOrCreateWallet(input.accountId);

  const description = `${creditPackage.name} top-up (${creditPackage.credits.toLocaleString()} cr)`;

  const { data, error: rpcErr } = await supabase.rpc('purchase_credits_tx', {
    p_account_id: input.accountId,
    p_amount: creditPackage.credits,
    p_description: description,
    p_gateway: input.gateway,
    p_gateway_payment_id: input.gatewayPaymentId,
    p_gateway_order_id: input.gatewayOrderId,
  });

  if (rpcErr) {
    if (rpcErr.code === '23505' || rpcErr.message?.includes('23505') || rpcErr.message?.includes('unique constraint')) {
      return { credited: false, credits: 0 };
    }
    throw new Error(`[creditPurchase] wallet update failed: ${rpcErr.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const wasCredited = Boolean(row?.success);

  if (wasCredited) {
    // Fire-and-forget — a failed notification must never fail the
    // purchase, which has already been committed above.
    void notifyManagerCreditsAdded(input.accountId, creditPackage.credits, creditPackage.name);
  }

  return { credited: wasCredited, credits: wasCredited ? creditPackage.credits : 0 };
}

/** Looks up the package price row for a given package + currency —
 *  used by the packages listing route and the buy route. */
export async function getPackagePrice(
  packageKey: string,
  currency: string,
): Promise<{ pkg: CreditPackage; price: CreditPackagePrice } | null> {
  const supabase = billingAdmin();

  const { data: pkg } = await supabase
    .from('credit_packages')
    .select('*')
    .eq('key', packageKey)
    .eq('is_active', true)
    .maybeSingle();

  if (!pkg) return null;

  const { data: price } = await supabase
    .from('credit_package_prices')
    .select('*')
    .eq('package_id', pkg.id)
    .eq('currency', currency)
    .eq('is_active', true)
    .maybeSingle();

  if (!price) return null;

  return { pkg: pkg as CreditPackage, price: price as CreditPackagePrice };
}
