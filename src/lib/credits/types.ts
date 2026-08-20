// ============================================================
// Credit engine types — mirrors migrations 085-089 exactly.
// Server and client code import from here; never re-declare locally.
// ============================================================

export type CreditBucket =
  | 'monthly'
  | 'bonus'
  | 'referral'
  | 'purchased'
  | 'promo'
  | 'pending_referral';

export type CreditTransactionType =
  | 'subscription_grant'
  | 'commitment_bonus'
  | 'referral_signup'
  | 'referral_upgrade'
  | 'referral_passive'
  | 'purchase'
  | 'admin_grant'
  | 'promo'
  | 'ai_burn'
  | 'expiry'
  | 'refund';

export type ReferralTier = 'bronze' | 'silver' | 'gold' | 'platinum';
export type ReferralStatus =
  | 'pending'
  | 'active'
  | 'converted'
  | 'expired'
  | 'invalid';
export type PaymentGateway = 'razorpay' | 'stripe';
export type CreditCurrency =
  | 'INR'
  | 'USD'
  | 'GBP'
  | 'EUR'
  | 'AED'
  | 'SGD'
  | 'AUD';
export type SubscriptionPlanForCredits = 'solo_pro' | 'team' | 'agency';
export type BillingCycleForCredits = 'monthly' | '3month' | '6month' | 'annual';

export interface CreditWallet {
  id: string;
  account_id: string;
  monthly_credits: number;
  bonus_credits: number;
  referral_credits: number;
  purchased_credits: number;
  promo_credits: number;
  pending_referral_credits: number;
  total_credits: number;
  referral_code: string;
  referral_tier: ReferralTier;
  paid_referral_count: number;
  monthly_reset_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreditTransaction {
  id: string;
  account_id: string;
  type: CreditTransactionType;
  bucket: CreditBucket;
  amount: number;
  balance_after: number;
  description: string | null;
  related_account_id: string | null;
  ai_feature: string | null;
  payment_gateway: PaymentGateway | null;
  gateway_payment_id: string | null;
  gateway_order_id: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface Referral {
  id: string;
  referrer_account_id: string;
  referee_account_id: string;
  status: ReferralStatus;
  referee_plan: string | null;
  passive_earn_months: number;
  passive_earn_expires_at: string | null;
  referee_phone_verified: boolean;
  signup_ip: string | null;
  signed_up_at: string;
  activated_at: string | null;
  converted_at: string | null;
}

export interface CreditPackage {
  id: string;
  key: string;
  name: string;
  credits: number;
  is_active: boolean;
  display_order: number;
}

export interface CreditPackagePrice {
  id: string;
  package_id: string;
  currency: CreditCurrency;
  gateway: PaymentGateway;
  amount_minor: number;
  is_active: boolean;
}

/** AI feature keys — single source of truth for burn costs. Import
 *  this map everywhere instead of hardcoding numbers at call sites.
 *  Only features with a real, invokable endpoint today are listed —
 *  the design doc's other tiers (image-generate, match-batch,
 *  broadcast-suggest, brochure, ROI-summary, voicenote) stay out
 *  until those endpoints exist. */
export const AI_FEATURE_COSTS = {
  property_description: 10,
  image_enhance: 25,
  chatbot_classify: 2,
  chatbot_auto_reply: 2,
  contact_parse: 5,
  listing_parse: 5,
  greetings_generate: 10,
  ad_copy: 10,
  share_email: 10,
  event_parse: 3,
  /** Turning an owner's voice note into text, once, before it is routed
   *  like any typed message. Paired with the parse it feeds — a spoken
   *  event costs this plus `event_parse`, which is what
   *  `voice_event_parse` charged when audio only ever meant scheduling. */
  voice_transcribe: 2,
  voice_event_parse: 5,
  image_event_parse: 5,
  call_analysis: 5,
  call_recording_analysis: 10,
  action_item_events: 3,
  /** Auto-generated listing video: Sarvam TTS narration + ffmpeg
   *  render on the worker (src/lib/video/). Priced above raw cost
   *  (~₹1-4 TTS + worker CPU) as a premium feature. */
  listing_video: 50,
  /** One voice-campaign dial attempt where WE pay the provider
   *  (shared and dedicated modes). Burned at dispatch, auto-refunded
   *  when the call never connects (start failure, stale,
   *  no-answer/busy) — accounts pay per connected call. Priced at
   *  ~2x the measured ₹9.80-14.70 raw cost of a 2-3 minute call; a
   *  credit is ₹0.062-0.099, not ₹1. See
   *  docs/credits-policy-voice-campaign-call.md. */
  voice_campaign_call: 250,
  /** The same dial in byo mode, where the account's own provider
   *  account is billed for the minutes. We charge for orchestration
   *  only — dispatch, retries, refunds, transcript ingestion and the
   *  writeback into matching — never for telephony they already
   *  paid for. */
  voice_campaign_call_byo: 10,
  /** Rendering an announcement to a WhatsApp voice note: Sarvam
   *  translate + TTS on the worker (src/lib/voice/announcement-worker.ts).
   *  Charged per generation, refunded by the worker on failure;
   *  sending the note costs nothing further. */
  audio_announcement: 5,
  /** One appointment reminder spoken as a voice note: a short
   *  per-reminder Sarvam translate + TTS render on the worker
   *  (src/lib/voice/reminder-audio-worker.ts). Refunded whenever the
   *  note never reaches the contact — the WhatsApp-template fallback
   *  that lands instead is free, like every other reminder. */
  reminder_audio: 2,
  /** One thread read end-to-end by the daily conversation sweep
   *  (src/lib/sweep/). Priced above `chatbot_classify` because the
   *  input is a whole transcript rather than one message, and below
   *  `contact_parse` because it runs at most once per thread per day
   *  and only on threads with something in them. */
  conversation_sweep_thread: 3,
} as const;

export type AiFeatureKey = keyof typeof AI_FEATURE_COSTS;

/**
 * What one dial attempt costs this account, which depends on who is
 * billed for the minutes: byo accounts pay their own provider, so they
 * are charged for orchestration only. Client-safe, because the price
 * has to be disclosed before the campaign is committed to (web dialog,
 * mobile sheet) and must never drift from what is burned.
 */
export function voiceCallCost(mode: string | null | undefined): number {
  return mode === 'byo'
    ? AI_FEATURE_COSTS.voice_campaign_call_byo
    : AI_FEATURE_COSTS.voice_campaign_call;
}

/** Non-AI billable feature keys (Owners Den marketplace actions).
 *  Same wallet, same burn/refund RPCs — just a different product
 *  surface. Tiering logic lives in src/lib/den/costs.ts. */
export const DEN_FEATURE_COSTS = {
  /** Reveal a Deal Mode property's full details + owner contact. */
  match_unlock: 50,
} as const;

export type DenFeatureKey = keyof typeof DEN_FEATURE_COSTS;

export type BillableFeatureKey = AiFeatureKey | DenFeatureKey;

/** Monthly credit grant per paid plan (Starter gets 0 — no AI access). */
export const MONTHLY_GRANT: Record<SubscriptionPlanForCredits, number> = {
  solo_pro: 500,
  team: 2000,
  agency: 8000,
};

/** One-time commitment bonus, as a fraction of total term credits,
 *  applied on top of the monthly grant when a long-term cycle is
 *  purchased. */
export const COMMITMENT_BONUS_PCT: Record<BillingCycleForCredits, number> = {
  monthly: 0,
  '3month': 0.15,
  '6month': 0.3,
  annual: 0.5,
};

export const CYCLE_MONTHS: Record<BillingCycleForCredits, number> = {
  monthly: 1,
  '3month': 3,
  '6month': 6,
  annual: 12,
};

/** Referrer reward for a referee upgrading to a paid plan — paid
 *  instantly and spendably since real payment already occurred. */
export const PLAN_CONVERSION_BONUS: Record<SubscriptionPlanForCredits, number> =
  {
    solo_pro: 500,
    team: 1500,
    agency: 4000,
  };

export const REFERRAL_SIGNUP_BONUS = 200; // both referee (instant) and referrer (pending)

export const REFERRAL_TIER_THRESHOLDS: {
  tier: ReferralTier;
  minConversions: number;
}[] = [
  { tier: 'platinum', minConversions: 15 },
  { tier: 'gold', minConversions: 7 },
  { tier: 'silver', minConversions: 3 },
  { tier: 'bronze', minConversions: 0 },
];

export function referralTierMultiplier(tier: ReferralTier): number {
  switch (tier) {
    case 'silver':
      return 1.1;
    case 'gold':
      return 1.25;
    case 'platinum':
      return 1.5;
    default:
      return 1;
  }
}

export function recomputeReferralTier(paidReferralCount: number): ReferralTier {
  const match = REFERRAL_TIER_THRESHOLDS.find(
    (t) => paidReferralCount >= t.minConversions
  );
  return match?.tier ?? 'bronze';
}

export type CreditStatus = 'healthy' | 'low' | 'critical' | 'empty';

export function deriveCreditStatus(totalCredits: number): CreditStatus {
  if (totalCredits <= 0) return 'empty';
  if (totalCredits <= 20) return 'critical';
  if (totalCredits <= 100) return 'low';
  return 'healthy';
}
