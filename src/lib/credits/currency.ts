// ============================================================
// Billing currency/gateway detection from phone country code.
//
// subscriptions.billing_currency / billing_gateway (migration 073)
// exist but nothing populates them today — this is the first real
// consumer. Detection happens lazily on first top-up purchase rather
// than at account creation, since most accounts never subscribe and
// forcing a `subscriptions` row for every Starter account would
// contradict migration 073's "no backfill required" design.
// ============================================================

import { billingAdmin } from '@/lib/billing/admin-client';
import type { CreditCurrency, PaymentGateway } from './types';

interface CountryBilling {
  currency: CreditCurrency;
  gateway: PaymentGateway;
}

// Longest-prefix-first so e.g. +91 (India) isn't shadowed by a
// shorter, unrelated prefix. Only prefixes we have real pricing for
// (credit_package_prices, migration 087) map to something other than
// the USD/Stripe fallback.
const COUNTRY_CODE_BILLING: [prefix: string, billing: CountryBilling][] = [
  ['+971', { currency: 'AED', gateway: 'stripe' }], // UAE
  ['+65', { currency: 'SGD', gateway: 'stripe' }], // Singapore
  ['+61', { currency: 'AUD', gateway: 'stripe' }], // Australia
  ['+91', { currency: 'INR', gateway: 'razorpay' }], // India
  ['+44', { currency: 'GBP', gateway: 'stripe' }], // UK
  ['+49', { currency: 'EUR', gateway: 'stripe' }], // Germany
  ['+33', { currency: 'EUR', gateway: 'stripe' }], // France
  ['+34', { currency: 'EUR', gateway: 'stripe' }], // Spain
  ['+39', { currency: 'EUR', gateway: 'stripe' }], // Italy
  ['+31', { currency: 'EUR', gateway: 'stripe' }], // Netherlands
  ['+353', { currency: 'EUR', gateway: 'stripe' }], // Ireland
  ['+1', { currency: 'USD', gateway: 'stripe' }], // US/Canada
];

// ConvoReal is an India-first WhatsApp CRM (per project scope) — the
// default, when there's no phone signal at all (e.g. Google OAuth
// signup with no phone captured) or an unrecognized country code,
// must be INR/Razorpay, not USD/Stripe. Routing to Stripe/another
// currency requires a *confirmed* non-Indian country code match
// below; ambiguity should never silently push a domestic user onto
// the wrong gateway and currency.
const DEFAULT_BILLING: CountryBilling = { currency: 'INR', gateway: 'razorpay' };

/**
 * Detects billing currency + gateway from a phone number's country
 * code. India (+91) is both the primary case for this WhatsApp-first
 * CRM and the fallback default — everything else routes to Stripe
 * only on a confirmed non-Indian country code match.
 */
export function resolveBillingFromPhone(phone: string | null | undefined): CountryBilling {
  if (!phone) return DEFAULT_BILLING;
  const normalized = phone.trim().startsWith('+') ? phone.trim() : `+${phone.trim().replace(/\D/g, '')}`;

  const sorted = [...COUNTRY_CODE_BILLING].sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, billing] of sorted) {
    if (normalized.startsWith(prefix)) return billing;
  }
  return DEFAULT_BILLING;
}

/**
 * Resolves the account's billing currency/gateway: uses the existing
 * `subscriptions` row if one exists, otherwise detects from the
 * account owner's phone and persists it onto a (possibly newly
 * created, Starter-plan) subscriptions row so it's sticky from here
 * on — "set once at account creation" per the design doc, just
 * applied lazily on first top-up instead of forcing every account to
 * have a subscriptions row up front.
 *
 * Always uses the service-role client: `subscriptions` RLS is
 * owner-only (both SELECT and INSERT), but any team member can
 * trigger a top-up purchase, so this detection must not depend on
 * the caller's own role.
 */
export async function getOrDetectBillingGateway(accountId: string): Promise<CountryBilling> {
  const supabase = billingAdmin();
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('billing_currency, billing_gateway')
    .eq('account_id', accountId)
    .maybeSingle();

  if (sub?.billing_currency && sub?.billing_gateway) {
    return { currency: sub.billing_currency as CreditCurrency, gateway: sub.billing_gateway as PaymentGateway };
  }

  const { data: managerProfile } = await supabase
    .from('profiles')
    .select('phone')
    .eq('account_id', accountId)
    .eq('org_role', 'org_manager')
    .maybeSingle();

  const detected = resolveBillingFromPhone(managerProfile?.phone);

  if (sub) {
    await supabase
      .from('subscriptions')
      .update({ billing_currency: detected.currency, billing_gateway: detected.gateway })
      .eq('account_id', accountId);
  } else {
    await supabase
      .from('subscriptions')
      .insert({ account_id: accountId, plan: 'starter', billing_currency: detected.currency, billing_gateway: detected.gateway });
  }

  return detected;
}
