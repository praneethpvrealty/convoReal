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

export interface PlanLimits {
  account_id: string;
  plan: Plan;
  status: SubscriptionStatus;
  billing_cycle: BillingCycle | null;
  current_period_end: string | null;
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
  | 'branded_showcase';

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
