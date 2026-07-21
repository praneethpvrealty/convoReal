import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PLAN_CONVERSION_BONUS,
  recomputeReferralTier,
  referralTierMultiplier,
  type SubscriptionPlanForCredits,
} from './types';

// ── Stateful billing-admin mock ────────────────────────────────────
// One referral + wallet + profile row. The referrals SELECT honors the
// `.in('status', [...])` filter, so once processReferralConversion flips
// the row to 'converted' a later call finds nothing — exactly the guard
// that makes a sequential webhook redelivery a no-op.
const grantRpc = vi.fn(() => Promise.resolve({ data: null, error: null }));

let state: {
  referral: Record<string, unknown> | null;
  wallet: Record<string, unknown>;
  profile: Record<string, unknown>;
};

function reset(overrides: Partial<typeof state> = {}) {
  state = {
    referral: {
      id: 'ref-1',
      referrer_account_id: 'acc-r',
      referee_account_id: 'acc-e',
      status: 'active',
    },
    wallet: { account_id: 'acc-r', paid_referral_count: 0, referral_tier: 'bronze' },
    profile: { full_name: 'Referee' },
    ...overrides,
  };
}

const mockDb = {
  rpc: (...args: unknown[]) => grantRpc(...(args as [])),
  from(table: string) {
    const q: { op: 'select' | 'update'; patch: Record<string, unknown> | null; inStatus: string[] | null } = {
      op: 'select',
      patch: null,
      inStatus: null,
    };
    const b: Record<string, unknown> = {
      select: () => b,
      update: (patch: Record<string, unknown>) => {
        q.op = 'update';
        q.patch = patch;
        return b;
      },
      eq: () => b,
      in: (col: string, vals: string[]) => {
        if (col === 'status') q.inStatus = vals;
        return b;
      },
      single: () => settle(),
      maybeSingle: () => settle(),
      then: (res: (v: unknown) => unknown) => Promise.resolve(settle()).then(res),
    };
    function row(): Record<string, unknown> | null {
      if (table === 'referrals') return state.referral;
      if (table === 'credit_wallets') return state.wallet;
      if (table === 'profiles') return state.profile;
      return null;
    }
    function settle() {
      const r = row();
      if (q.op === 'update') {
        if (r) Object.assign(r, q.patch);
        return Promise.resolve({ data: r, error: null });
      }
      if (table === 'referrals' && q.inStatus) {
        return Promise.resolve({ data: r && q.inStatus.includes(String(r.status)) ? r : null, error: null });
      }
      return Promise.resolve({ data: r, error: null });
    }
    return b;
  },
};

vi.mock('@/lib/billing/admin-client', () => ({ billingAdmin: () => mockDb }));
vi.mock('./wallet', () => ({ getOrCreateWallet: vi.fn() }));
vi.mock('./notify', () => ({
  notifyManagerReferralConverted: vi.fn(),
  notifyReferrerPendingVoided: vi.fn(),
}));

const { processReferralConversion } = await import('./referral');

function expectedAmount(plan: SubscriptionPlanForCredits, priorPaidCount: number): number {
  const tier = recomputeReferralTier(priorPaidCount + 1);
  return Math.round(PLAN_CONVERSION_BONUS[plan] * referralTierMultiplier(tier));
}

beforeEach(() => reset());

describe('processReferralConversion', () => {
  it('grants the conversion bonus once and marks the referral converted', async () => {
    await processReferralConversion('acc-e', 'solo_pro');

    expect(grantRpc).toHaveBeenCalledTimes(1);
    const args = grantRpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(args[0]).toBe('grant_referral_credits_tx');
    expect(args[1].p_amount).toBe(expectedAmount('solo_pro', 0));
    expect(state.referral?.status).toBe('converted');
    expect(state.wallet.paid_referral_count).toBe(1);
  });

  it('is a no-op on sequential redelivery (status filter guards re-entry)', async () => {
    await processReferralConversion('acc-e', 'solo_pro');
    await processReferralConversion('acc-e', 'solo_pro');
    // Second call finds status 'converted' (outside pending|active) and
    // returns early — no second grant. NOTE: this guards sequential
    // redelivery, not two truly concurrent calls that both read
    // 'active' before either writes 'converted' (a residual race).
    expect(grantRpc).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the account has no referral source', async () => {
    reset({ referral: null });
    await processReferralConversion('acc-e', 'team');
    expect(grantRpc).not.toHaveBeenCalled();
  });

  it('scales the bonus by the referral tier multiplier as paid count grows', async () => {
    reset({ wallet: { account_id: 'acc-r', paid_referral_count: 25, referral_tier: 'bronze' } });
    await processReferralConversion('acc-e', 'agency');

    const args = grantRpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(args[1].p_amount).toBe(expectedAmount('agency', 25));
    expect(state.wallet.paid_referral_count).toBe(26);
  });
});
