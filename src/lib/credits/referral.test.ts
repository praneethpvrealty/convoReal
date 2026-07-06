import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  state: {
    walletsByCode: {} as Record<string, { account_id: string }>,
    existingReferralByReferee: {} as Record<string, { id: string }>,
    profilesByAccount: {} as Record<string, { phone: string | null; full_name?: string | null; user_id?: string }>,
    walletsByAccount: {} as Record<string, Record<string, unknown>>,
    insertedReferrals: [] as Record<string, unknown>[],
    rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
    accountsWithReferredByCode: [] as { id: string; referred_by_code: string }[],
  },
}));

vi.mock('@/lib/billing/admin-client', () => {
  const { state } = h;

  function builder(table: string) {
    const ops: { type: string; filters: [string, unknown][] } = { type: 'select', filters: [] };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (col: string, val: unknown) => {
        ops.filters.push([col, val]);
        return b;
      },
      in: () => b,
      not: () => b,
      insert: (payload: Record<string, unknown>) => {
        if (table === 'referrals') state.insertedReferrals.push(payload);
        return { error: null };
      },
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      maybeSingle: () => {
        if (table === 'credit_wallets') {
          const code = ops.filters.find(([c]) => c === 'referral_code')?.[1] as string | undefined;
          return Promise.resolve({ data: code ? state.walletsByCode[code] ?? null : null, error: null });
        }
        if (table === 'referrals') {
          const referee = ops.filters.find(([c]) => c === 'referee_account_id')?.[1] as string | undefined;
          return Promise.resolve({ data: (referee && state.existingReferralByReferee[referee]) ?? null, error: null });
        }
        if (table === 'profiles') {
          const acct = ops.filters.find(([c]) => c === 'account_id')?.[1] as string | undefined;
          return Promise.resolve({ data: (acct && state.profilesByAccount[acct]) ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      single: () => {
        if (table === 'credit_wallets') {
          const acct = ops.filters.find(([c]) => c === 'account_id')?.[1] as string | undefined;
          return Promise.resolve({ data: (acct && state.walletsByAccount[acct]) ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => unknown) => {
        if (table === 'accounts') {
          return Promise.resolve({ data: state.accountsWithReferredByCode, error: null }).then(resolve);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return b;
  }

  return {
    billingAdmin: () => ({
      from: (table: string) => builder(table),
      rpc: (fn: string, args: Record<string, unknown>) => {
        state.rpcCalls.push({ fn, args });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
});

vi.mock('./wallet', () => ({
  getOrCreateWallet: vi.fn(() => Promise.resolve({})),
}));

vi.mock('./notify', () => ({
  notifyManagerReferralConverted: vi.fn(() => Promise.resolve()),
  notifyReferrerPendingVoided: vi.fn(() => Promise.resolve()),
}));

const { processReferralSignup, payoutPassiveEarn, processUnclaimedReferralSignups } = await import('./referral');

describe('processReferralSignup', () => {
  beforeEach(() => {
    h.state.walletsByCode = { REF123: { account_id: 'referrer-acct' } };
    h.state.existingReferralByReferee = {};
    h.state.profilesByAccount = { 'referee-acct': { phone: '+919876543210' } };
    h.state.insertedReferrals = [];
    h.state.rpcCalls = [];
  });

  it('rejects a code that does not resolve to any wallet', async () => {
    const result = await processReferralSignup('referee-acct', 'DOESNOTEXIST');
    expect(result.created).toBe(false);
    expect(result.reason).toMatch(/not found/i);
    expect(h.state.insertedReferrals).toHaveLength(0);
  });

  it('rejects self-referral (referrer and referee are the same account)', async () => {
    h.state.walletsByCode.SELFCODE = { account_id: 'referee-acct' };
    const result = await processReferralSignup('referee-acct', 'SELFCODE');
    expect(result.created).toBe(false);
    expect(result.reason).toMatch(/self-referral/i);
  });

  it('rejects an account that already has a referral source', async () => {
    h.state.existingReferralByReferee['referee-acct'] = { id: 'existing-ref' };
    const result = await processReferralSignup('referee-acct', 'REF123');
    expect(result.created).toBe(false);
    expect(result.reason).toMatch(/already has a referral/i);
  });

  it('creates the referral, grants the referee spendably, and the referrer as pending', async () => {
    const result = await processReferralSignup('referee-acct', 'REF123');

    expect(result.created).toBe(true);
    expect(h.state.insertedReferrals).toHaveLength(1);
    expect(h.state.insertedReferrals[0]).toMatchObject({
      referrer_account_id: 'referrer-acct',
      referee_account_id: 'referee-acct',
      status: 'pending',
      referee_phone_verified: true,
    });

    const refereeGrant = h.state.rpcCalls.find((c) => c.fn === 'grant_referral_credits_tx');
    expect(refereeGrant?.args).toMatchObject({ p_account_id: 'referee-acct', p_amount: 200 });

    const referrerPending = h.state.rpcCalls.find((c) => c.fn === 'grant_pending_referral_tx');
    expect(referrerPending?.args).toMatchObject({ p_account_id: 'referrer-acct', p_amount: 200 });
  });
});

describe('processUnclaimedReferralSignups', () => {
  beforeEach(() => {
    h.state.walletsByCode = { REF123: { account_id: 'referrer-acct' } };
    h.state.existingReferralByReferee = {};
    h.state.profilesByAccount = { 'referee-acct': { phone: '+919876543210' } };
    h.state.insertedReferrals = [];
    h.state.rpcCalls = [];
    h.state.accountsWithReferredByCode = [];
  });

  it('processes an account with a captured referred_by_code and no existing referral row', async () => {
    h.state.accountsWithReferredByCode = [{ id: 'referee-acct', referred_by_code: 'REF123' }];

    const result = await processUnclaimedReferralSignups();

    expect(result).toEqual({ processed: 1, checked: 1 });
    expect(h.state.insertedReferrals).toHaveLength(1);
  });

  it('skips accounts that already have a referrals row (idempotent)', async () => {
    h.state.accountsWithReferredByCode = [{ id: 'referee-acct', referred_by_code: 'REF123' }];
    h.state.existingReferralByReferee['referee-acct'] = { id: 'already-processed' };

    const result = await processUnclaimedReferralSignups();

    expect(result).toEqual({ processed: 0, checked: 1 });
    expect(h.state.insertedReferrals).toHaveLength(0);
  });

  it('does nothing when no accounts have a captured referral code', async () => {
    const result = await processUnclaimedReferralSignups();
    expect(result).toEqual({ processed: 0, checked: 0 });
  });
});

describe('payoutPassiveEarn', () => {
  beforeEach(() => {
    h.state.rpcCalls = [];
    h.state.walletsByAccount = { 'referrer-acct': { referral_tier: 'bronze' } };
  });

  function baseReferral(overrides: Partial<Parameters<typeof payoutPassiveEarn>[0]> = {}) {
    return {
      id: 'ref-1',
      referrer_account_id: 'referrer-acct',
      referee_account_id: 'referee-acct',
      status: 'converted' as const,
      referee_plan: 'team',
      passive_earn_months: 0,
      passive_earn_expires_at: null,
      referee_phone_verified: true,
      signup_ip: null,
      signed_up_at: '2026-01-01T00:00:00Z',
      activated_at: '2026-01-08T00:00:00Z',
      converted_at: '2026-01-10T00:00:00Z',
      ...overrides,
    };
  }

  it('is idempotent — refuses to pay once 12 months have already been paid', async () => {
    const result = await payoutPassiveEarn(baseReferral({ passive_earn_months: 12 }));
    expect(result.paid).toBe(false);
    expect(h.state.rpcCalls).toHaveLength(0);
  });

  it('refuses to pay once the 12-month window has expired', async () => {
    const result = await payoutPassiveEarn(
      baseReferral({ passive_earn_expires_at: '2020-01-01T00:00:00Z' }),
    );
    expect(result.paid).toBe(false);
    expect(h.state.rpcCalls).toHaveLength(0);
  });

  it('refuses to pay when the referee has no recognized plan', async () => {
    const result = await payoutPassiveEarn(baseReferral({ referee_plan: null }));
    expect(result.paid).toBe(false);
  });

  it('pays 10% of the monthly grant for a Team-plan referee at bronze tier', async () => {
    const result = await payoutPassiveEarn(baseReferral());
    expect(result.paid).toBe(true);
    const call = h.state.rpcCalls.find((c) => c.fn === 'grant_referral_credits_tx');
    // Team monthly grant is 2000 -> 10% = 200, bronze multiplier = 1x
    expect(call?.args).toMatchObject({ p_account_id: 'referrer-acct', p_amount: 200, p_type: 'referral_passive' });
  });

  it('applies the referrer tier multiplier to the passive payout', async () => {
    h.state.walletsByAccount['referrer-acct'] = { referral_tier: 'gold' };
    const result = await payoutPassiveEarn(baseReferral());
    expect(result.paid).toBe(true);
    const call = h.state.rpcCalls.find((c) => c.fn === 'grant_referral_credits_tx');
    // 2000 * 10% * 1.25 (gold) = 250
    expect(call?.args.p_amount).toBe(250);
  });
});
