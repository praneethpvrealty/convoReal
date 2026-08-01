import { describe, expect, it } from 'vitest';
import {
  computeBillingSummary,
  monthlyEquivalent,
  toMonthlyPoints,
  type MonthlyBillingRow,
  type PlanBreakdownRow,
} from './analytics';
import { PLAN_CONFIG } from './plan-config';

function row(overrides: Partial<PlanBreakdownRow>): PlanBreakdownRow {
  return {
    plan: 'starter',
    billing_cycle: null,
    status: 'active',
    accounts: 1,
    ...overrides,
  };
}

describe('monthlyEquivalent', () => {
  it('returns the monthly price for monthly and null cycles', () => {
    expect(monthlyEquivalent('team', 'monthly')).toBe(
      PLAN_CONFIG.team.monthlyPrice
    );
    expect(monthlyEquivalent('team', null)).toBe(PLAN_CONFIG.team.monthlyPrice);
  });

  it('normalizes quarterly and annual prices to per-month', () => {
    expect(monthlyEquivalent('solo_pro', 'quarterly')).toBeCloseTo(
      PLAN_CONFIG.solo_pro.quarterlyPrice / 3
    );
    expect(monthlyEquivalent('agency', 'annual')).toBeCloseTo(
      PLAN_CONFIG.agency.annualPrice / 12
    );
  });
});

describe('computeBillingSummary', () => {
  it('sums MRR across plans and cycles', () => {
    const summary = computeBillingSummary([
      row({ plan: 'team', billing_cycle: 'monthly', accounts: 2 }),
      row({ plan: 'solo_pro', billing_cycle: 'annual', accounts: 3 }),
      row({ plan: 'starter', accounts: 10 }),
    ]);

    const expected =
      2 * PLAN_CONFIG.team.monthlyPrice +
      3 * (PLAN_CONFIG.solo_pro.annualPrice / 12);
    expect(summary.mrr).toBe(Math.round(expected));
    expect(summary.paidAccounts).toBe(5);
    expect(summary.totalAccounts).toBe(15);
    expect(summary.planCounts).toEqual({
      starter: 10,
      solo_pro: 3,
      team: 2,
      agency: 0,
    });
    expect(summary.mrrByPlan.starter).toBe(0);
    expect(summary.mrrByPlan.team).toBe(2 * PLAN_CONFIG.team.monthlyPrice);
  });

  it('excludes canceled and trialing subscriptions from MRR but not from plan counts', () => {
    const summary = computeBillingSummary([
      row({ plan: 'agency', billing_cycle: 'monthly', status: 'canceled' }),
      row({ plan: 'team', billing_cycle: 'monthly', status: 'trialing' }),
      row({ plan: 'team', billing_cycle: 'monthly', status: 'past_due' }),
      row({ plan: 'team', billing_cycle: 'monthly', status: 'grace_period' }),
    ]);

    expect(summary.mrr).toBe(2 * PLAN_CONFIG.team.monthlyPrice);
    expect(summary.paidAccounts).toBe(2);
    expect(summary.planCounts.agency).toBe(1);
    expect(summary.planCounts.team).toBe(3);
  });

  it('handles an empty breakdown', () => {
    const summary = computeBillingSummary([]);
    expect(summary.mrr).toBe(0);
    expect(summary.paidAccounts).toBe(0);
    expect(summary.totalAccounts).toBe(0);
  });
});

describe('toMonthlyPoints', () => {
  it('converts paise amounts to rupees and camel-cases fields', () => {
    const rows: MonthlyBillingRow[] = [
      {
        month: '2026-07',
        new_accounts: 4,
        upgrades: 2,
        downgrades: 1,
        cancellations: 1,
        payments: 3,
        subscription_revenue_paise: 749700,
        topup_revenue_paise: 49900,
        credits_purchased: 500,
        ai_credits_burned: 120,
      },
    ];

    expect(toMonthlyPoints(rows)).toEqual([
      {
        month: '2026-07',
        newAccounts: 4,
        upgrades: 2,
        downgrades: 1,
        cancellations: 1,
        payments: 3,
        subscriptionRevenue: 7497,
        topupRevenue: 499,
        creditsPurchased: 500,
        aiCreditsBurned: 120,
      },
    ]);
  });
});
