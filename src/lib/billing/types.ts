// ============================================================
// Billing types — mirrors 073_billing_subscriptions.sql exactly.
// Server and client code import from here; never re-declare locally.
// ============================================================

export type Plan = 'starter' | 'solo_pro' | 'team' | 'agency';
export type BillingCycle = 'monthly' | 'quarterly' | 'annual';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'grace_period';
export type BillingGateway = 'razorpay' | 'stripe';

export interface Subscription {
  id: string;
  account_id: string;
  plan: Plan;
  billing_cycle: BillingCycle | null;
  status: SubscriptionStatus;
  razorpay_subscription_id: string | null;
  razorpay_customer_id: string | null;
  razorpay_plan_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  pending_plan: Plan | null;
  pending_plan_effective_at: string | null;
  trial_ends_at: string | null;
  canceled_at: string | null;
  billing_currency: string;
  billing_gateway: BillingGateway;
  created_at: string;
  updated_at: string;
}

export type ExtensionReason =
  | 'outage'
  | 'degraded_service'
  | 'billing_error'
  | 'onboarding_delay'
  | 'support_goodwill';

// Admin-granted service credit — mirrors 204_subscription_extensions.sql.
export interface SubscriptionExtension {
  id: string;
  account_id: string;
  days: number;
  extended_until: string;
  period_end_before: string | null;
  reason: ExtensionReason;
  /** Internal operator shorthand — never shown to the customer. */
  note: string | null;
  /** Customer-facing override for the canned line, when the admin set one. */
  customer_message: string | null;
  incident_ref: string | null;
  granted_by: string | null;
  granted_by_email: string | null;
  notified_at: string | null;
  notification_result: unknown;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  created_at: string;
}

export interface PlanLimits {
  account_id: string;
  plan: Plan;
  status: SubscriptionStatus;
  billing_cycle: BillingCycle | null;
  /** The gateway's own period end, mirrored from Razorpay/Stripe. */
  current_period_end: string | null;
  /** Days of admin-granted credit still in force (204). */
  extension_days: number;
  /** What access actually runs to: the later of current_period_end and
   *  any live extension. Show this to customers, not current_period_end. */
  effective_period_end: string | null;
  pending_plan: Plan | null;
  pending_plan_effective_at: string | null;
  max_users: number;
  max_contacts: number;
  max_properties: number;
  max_broadcasts_per_month: number;
  has_ai: boolean;
  has_teams: boolean;
  has_multi_number: boolean;
  has_api_access: boolean;
  has_branded_showcase: boolean;
  has_custom_subdomain: boolean;
}

export type GatedFeature =
  | 'contacts'
  | 'properties'
  | 'users'
  | 'broadcasts'
  | 'ai'
  | 'teams'
  | 'multi_number'
  | 'api_access'
  | 'branded_showcase'
  | 'meta_ads';

export interface GateResult {
  allowed: boolean;
  currentCount?: number;
  limit?: number;
  reason?: string;
  upgradeRequired?: Plan;
}

// What the /api/billing/status endpoint returns
export interface BillingStatus {
  subscription: Subscription | null;
  limits: PlanLimits;
  usage: {
    contacts: number;
    properties: number;
    users: number;
  };
}
