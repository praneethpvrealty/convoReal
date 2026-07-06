import { describe, it, expect, beforeEach, vi } from 'vitest';

// burn.ts is a thin RPC wrapper — the actual bucket-priority
// deduction logic lives in the burn_credits_tx SQL function
// (migration 089), verified by manual SQL-editor testing since
// there's no local Postgres available to exercise PL/pgSQL directly.
// These tests cover only the TS-side contract: request shape sent to
// the RPC, and response shape returned to callers.
const h = vi.hoisted(() => ({
  state: {
    rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
    rpcResponse: { success: true, balance_after: 0, deficit: 0 } as Record<string, unknown>,
  },
}));

vi.mock('@/lib/billing/admin-client', () => ({
  billingAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.state.rpcCalls.push({ fn, args });
      return Promise.resolve({ data: [h.state.rpcResponse], error: null });
    },
  }),
}));

vi.mock('./wallet', () => ({
  getOrCreateWallet: vi.fn(() => Promise.resolve({})),
}));

const { burnCredits } = await import('./burn');

describe('burnCredits', () => {
  beforeEach(() => {
    h.state.rpcCalls = [];
  });

  it('defaults to hard-block and passes cost/feature through to the RPC', async () => {
    h.state.rpcResponse = { success: true, balance_after: 40, deficit: 0 };
    const result = await burnCredits('acct-1', 'property_description', 10);

    expect(h.state.rpcCalls[0].fn).toBe('burn_credits_tx');
    expect(h.state.rpcCalls[0].args).toMatchObject({
      p_account_id: 'acct-1',
      p_feature: 'property_description',
      p_cost: 10,
      p_hard_block: true,
    });
    expect(result).toEqual({ success: true, balanceAfter: 40, deficit: 0 });
  });

  it('surfaces a hard-block failure without throwing', async () => {
    h.state.rpcResponse = { success: false, balance_after: 5, deficit: 5 };
    const result = await burnCredits('acct-1', 'image_enhance', 25);

    expect(result.success).toBe(false);
    expect(result.deficit).toBe(5);
  });

  it('passes hardBlock: false for the chatbot soft-block path', async () => {
    h.state.rpcResponse = { success: true, balance_after: 0, deficit: 3 };
    const result = await burnCredits('acct-1', 'chatbot_classify', 2, { hardBlock: false });

    expect(h.state.rpcCalls[0].args.p_hard_block).toBe(false);
    // Soft-block always reports success so the caller proceeds, even
    // though `deficit` shows the shortfall for logging.
    expect(result.success).toBe(true);
    expect(result.deficit).toBe(3);
  });

  it('forwards a retryKey for the idempotency window', async () => {
    h.state.rpcResponse = { success: true, balance_after: 40, deficit: 0 };
    await burnCredits('acct-1', 'listing_parse', 5, { retryKey: 'wamid.123' });

    expect(h.state.rpcCalls[0].args.p_retry_key).toBe('wamid.123');
  });
});
