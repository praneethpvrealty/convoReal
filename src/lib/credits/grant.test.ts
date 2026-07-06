import { describe, it, expect, beforeEach, vi } from 'vitest';

// Shared mock state for the service-role client, following the
// hoisted-state convention used in src/lib/automations/engine.test.ts.
const h = vi.hoisted(() => ({
  state: {
    wallet: null as Record<string, unknown> | null,
    packages: [] as Record<string, unknown>[],
    existingTxOrderIds: new Set<string>(),
    rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
    insertedTx: [] as Record<string, unknown>[],
    walletUpdates: [] as Record<string, unknown>[],
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
      insert: (payload: Record<string, unknown>) => {
        ops.type = 'insert';
        if (table === 'credit_transactions') state.insertedTx.push(payload);
        return b;
      },
      update: (payload: Record<string, unknown>) => {
        ops.type = 'update';
        if (table === 'credit_wallets') state.walletUpdates.push(payload);
        return b;
      },
      maybeSingle: () => {
        if (table === 'credit_transactions') {
          const orderId = ops.filters.find(([c]) => c === 'gateway_order_id')?.[1] as string | undefined;
          if (orderId && state.existingTxOrderIds.has(orderId)) {
            return Promise.resolve({ data: { id: 'existing-tx' }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        }
        if (table === 'credit_packages') {
          const key = ops.filters.find(([c]) => c === 'key')?.[1];
          const pkg = state.packages.find((p) => p.key === key);
          return Promise.resolve({ data: pkg ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      single: () => {
        if (table === 'credit_wallets') return Promise.resolve({ data: state.wallet, error: state.wallet ? null : new Error('not found') });
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
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
  getOrCreateWallet: vi.fn(() => Promise.resolve(h.state.wallet)),
}));

const { grantSubscriptionCredits, creditPurchase } = await import('./grant');

describe('grantSubscriptionCredits', () => {
  beforeEach(() => {
    h.state.rpcCalls = [];
  });

  it('resets the monthly bucket without a commitment bonus for a plain monthly cycle', async () => {
    await grantSubscriptionCredits('acct-1', 'solo_pro', 'monthly', {
      isNewCycle: true,
      periodEnd: '2026-08-01T00:00:00Z',
    });

    expect(h.state.rpcCalls).toHaveLength(1);
    const call = h.state.rpcCalls[0];
    expect(call.fn).toBe('grant_subscription_credits_tx');
    expect(call.args.p_monthly_amount).toBe(500);
    expect(call.args.p_bonus_delta).toBe(0);
  });

  it('applies the commitment bonus on a new annual cycle', async () => {
    await grantSubscriptionCredits('acct-1', 'team', 'annual', {
      isNewCycle: true,
      periodEnd: '2027-07-01T00:00:00Z',
    });

    const call = h.state.rpcCalls[0];
    expect(call.args.p_monthly_amount).toBe(2000);
    // 2000 * 12 months * 50% = 12000
    expect(call.args.p_bonus_delta).toBe(12000);
  });

  it('does not re-apply the commitment bonus on a plain renewal within an existing term', async () => {
    await grantSubscriptionCredits('acct-1', 'team', 'annual', {
      isNewCycle: false,
      periodEnd: '2027-07-01T00:00:00Z',
    });

    const call = h.state.rpcCalls[0];
    expect(call.args.p_bonus_delta).toBe(0);
  });
});

describe('creditPurchase', () => {
  beforeEach(() => {
    h.state.existingTxOrderIds = new Set();
    h.state.insertedTx = [];
    h.state.walletUpdates = [];
    h.state.packages = [{ id: 'pkg-1', key: 'standard', name: 'Standard Pack', credits: 2500 }];
    h.state.wallet = {
      purchased_credits: 100,
      monthly_credits: 50,
      bonus_credits: 0,
      referral_credits: 0,
      promo_credits: 0,
    };
  });

  it('credits the purchased bucket and inserts a ledger row on first delivery', async () => {
    const result = await creditPurchase({
      accountId: 'acct-1',
      packageKey: 'standard',
      gateway: 'razorpay',
      gatewayOrderId: 'order_123',
      gatewayPaymentId: 'pay_123',
      currency: 'INR',
    });

    expect(result).toEqual({ credited: true, credits: 2500 });
    expect(h.state.walletUpdates).toHaveLength(1);
    expect(h.state.walletUpdates[0].purchased_credits).toBe(2600);
    expect(h.state.insertedTx).toHaveLength(1);
    expect(h.state.insertedTx[0]).toMatchObject({
      type: 'purchase',
      bucket: 'purchased',
      amount: 2500,
      gateway_order_id: 'order_123',
    });
  });

  it('is idempotent — a webhook redelivery with the same gateway_order_id does not double-credit', async () => {
    h.state.existingTxOrderIds.add('order_123');

    const result = await creditPurchase({
      accountId: 'acct-1',
      packageKey: 'standard',
      gateway: 'razorpay',
      gatewayOrderId: 'order_123',
      gatewayPaymentId: 'pay_123',
      currency: 'INR',
    });

    expect(result).toEqual({ credited: false, credits: 0 });
    expect(h.state.walletUpdates).toHaveLength(0);
    expect(h.state.insertedTx).toHaveLength(0);
  });
});
