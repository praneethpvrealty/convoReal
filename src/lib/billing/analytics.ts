import { PLAN_CONFIG, PLAN_ORDER } from './plan-config';
import type { BillingCycle, Plan, SubscriptionStatus } from './types';

export interface PlanBreakdownRow {
  plan: Plan;
  billing_cycle: BillingCycle | null;
  status: SubscriptionStatus;
  accounts: number;
}

export interface MonthlyBillingRow {
  month: string;
  new_accounts: number;
  upgrades: number;
  downgrades: number;
  cancellations: number;
  payments: number;
  subscription_revenue_paise: number;
  topup_revenue_paise: number;
  credits_purchased: number;
  ai_credits_burned: number;
}

export interface RecentSubscriptionEvent {
  id: string;
  account_name: string | null;
  event_type: string;
  from_plan: Plan | null;
  to_plan: Plan | null;
  created_at: string;
}

export interface BillingAnalyticsRaw {
  plans: PlanBreakdownRow[];
  monthly: MonthlyBillingRow[];
  recent_events: RecentSubscriptionEvent[];
}

export interface MonthlyBillingPoint {
  month: string;
  newAccounts: number;
  upgrades: number;
  downgrades: number;
  cancellations: number;
  payments: number;
  subscriptionRevenue: number;
  topupRevenue: number;
  creditsPurchased: number;
  aiCreditsBurned: number;
}

export interface BillingSummary {
  mrr: number;
  paidAccounts: number;
  totalAccounts: number;
  planCounts: Record<Plan, number>;
  mrrByPlan: Record<Plan, number>;
}

const PAYING_STATUSES: SubscriptionStatus[] = [
  'active',
  'past_due',
  'grace_period',
];

export function monthlyEquivalent(
  plan: Plan,
  cycle: BillingCycle | null
): number {
  const config = PLAN_CONFIG[plan];
  if (cycle === 'annual') return config.annualPrice / 12;
  if (cycle === 'quarterly') return config.quarterlyPrice / 3;
  return config.monthlyPrice;
}

export function computeBillingSummary(
  plans: PlanBreakdownRow[]
): BillingSummary {
  const planCounts = Object.fromEntries(
    PLAN_ORDER.map((p) => [p, 0])
  ) as Record<Plan, number>;
  const mrrByPlanExact = Object.fromEntries(
    PLAN_ORDER.map((p) => [p, 0])
  ) as Record<Plan, number>;
  let totalAccounts = 0;
  let paidAccounts = 0;
  let mrrExact = 0;

  for (const row of plans) {
    totalAccounts += row.accounts;
    planCounts[row.plan] = (planCounts[row.plan] ?? 0) + row.accounts;
    if (row.plan === 'starter' || !PAYING_STATUSES.includes(row.status))
      continue;
    paidAccounts += row.accounts;
    const contribution =
      row.accounts * monthlyEquivalent(row.plan, row.billing_cycle);
    mrrByPlanExact[row.plan] += contribution;
    mrrExact += contribution;
  }

  const mrrByPlan = Object.fromEntries(
    PLAN_ORDER.map((p) => [p, Math.round(mrrByPlanExact[p])])
  ) as Record<Plan, number>;

  return {
    mrr: Math.round(mrrExact),
    paidAccounts,
    totalAccounts,
    planCounts,
    mrrByPlan,
  };
}

export function toMonthlyPoints(
  monthly: MonthlyBillingRow[]
): MonthlyBillingPoint[] {
  return monthly.map((row) => ({
    month: row.month,
    newAccounts: row.new_accounts,
    upgrades: row.upgrades,
    downgrades: row.downgrades,
    cancellations: row.cancellations,
    payments: row.payments,
    subscriptionRevenue: Math.round(row.subscription_revenue_paise) / 100,
    topupRevenue: Math.round(row.topup_revenue_paise) / 100,
    creditsPurchased: row.credits_purchased,
    aiCreditsBurned: row.ai_credits_burned,
  }));
}
