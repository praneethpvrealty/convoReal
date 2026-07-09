// ============================================================
// Refund policy — single source of truth.
//
// The canonical numbers/terms so the /refund-policy page, checkout
// copy, credit-purchase notes, and any future refund logic never
// drift apart. If a window or carve-out changes, change it here.
// ============================================================

import { BRANDING } from '@/config/branding';

export const REFUND_POLICY = {
  /** No-questions money-back window on the FIRST paid upgrade, once per
   *  account. The core trust-builder at the upgrade decision. */
  firstPurchaseGuaranteeDays: 7,

  /** A credit top-up pack is refundable only if it is 100% unused
   *  within this window; once any credit from it is spent, it's not. */
  creditTopupRefundDays: 7,

  /** Prepaid quarterly/annual terms: pro-rata refund of unused whole
   *  months (used months clawed back at the monthly rate) is available
   *  within this window from purchase. */
  prepaidProrataDays: 30,

  /** Typical time for an approved refund to reach the original payment
   *  method (Razorpay → bank/UPI). */
  processingBusinessDays: '5–7',

  /** Where refund/cancellation requests go. */
  supportEmail: 'hello@convoreal.com',

  brandName: BRANDING.name,
} as const;

/** Human-readable one-liner reused in checkout/settings copy. */
export const REFUND_GUARANTEE_BLURB = `Cancel anytime · No lock-in · ${REFUND_POLICY.firstPurchaseGuaranteeDays}-day money-back on your first upgrade`;
