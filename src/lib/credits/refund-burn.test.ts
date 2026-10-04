import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Write {
  table: string;
  op: 'upsert' | 'update';
  payload: Record<string, unknown>;
  options?: unknown;
  filters: Array<[string, unknown]>;
}

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  queued: [] as Record<string, unknown>[],
  selectFilters: [] as Array<[string, unknown]>,
  writes: [] as Write[],
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (...args: unknown[]) => h.rpc(...args),
    from(table: string) {
      const write = (
        op: Write['op'],
        payload: Record<string, unknown>,
        options?: unknown
      ) => {
        const entry: Write = { table, op, payload, options, filters: [] };
        h.writes.push(entry);
        const chain = {
          eq(column: string, value: unknown) {
            entry.filters.push([column, value]);
            return chain;
          },
          then(resolve: (v: { error: null }) => unknown) {
            return Promise.resolve({ error: null }).then(resolve);
          },
        };
        return chain;
      };
      const select = {
        is(column: string, value: unknown) {
          h.selectFilters.push(['is:' + column, value]);
          return select;
        },
        lt(column: string, value: unknown) {
          h.selectFilters.push(['lt:' + column, value]);
          return select;
        },
        order() {
          return select;
        },
        limit() {
          return Promise.resolve({ data: h.queued, error: null });
        },
      };
      return {
        upsert: (payload: Record<string, unknown>, options: unknown) =>
          write('upsert', payload, options),
        update: (payload: Record<string, unknown>) => write('update', payload),
        select: () => select,
      };
    },
  }),
}));

const {
  newBurnKey,
  refundBurn,
  retryQueuedRefunds,
  QUEUED_REFUND_ATTEMPT_LIMIT,
} = await import('./refund-burn');

beforeEach(() => {
  vi.useFakeTimers();
  h.rpc.mockReset();
  h.queued = [];
  h.selectFilters = [];
  h.writes = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('[INB-027] refundBurn', () => {
  it('names a burn by its feature and a fresh id', () => {
    const a = newBurnKey('contact_parse');
    expect(a).toMatch(/^contact_parse:[0-9a-f-]{36}$/);
    expect(newBurnKey('contact_parse')).not.toBe(a);
  });

  it('refunds exactly the keyed burn', async () => {
    h.rpc.mockResolvedValue({
      data: [{ refunded: 4, balance_after: 90 }],
      error: null,
    });

    const result = await refundBurn(
      'acct-1',
      'contact_parse',
      'contact_parse:k1'
    );

    expect(result).toEqual({ status: 'refunded', refunded: 4 });
    expect(h.rpc).toHaveBeenCalledWith('refund_burn_tx', {
      p_account_id: 'acct-1',
      p_feature: 'contact_parse',
      p_burn_key: 'contact_parse:k1',
    });
    expect(h.writes).toEqual([]);
  });

  it('retries a failed call, which is safe because the refund is keyed', async () => {
    h.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout' } })
      .mockResolvedValueOnce({ data: [{ refunded: 4 }], error: null });

    const pending = refundBurn('acct-1', 'contact_parse', 'contact_parse:k1');
    await vi.runAllTimersAsync();

    expect(await pending).toEqual({ status: 'refunded', refunded: 4 });
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });

  it('queues the refund for the cron after three failed calls', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'db down' } });

    const pending = refundBurn('acct-1', 'listing_parse', 'listing_parse:k2', {
      reason: 'e-Khata read failed',
    });
    await vi.runAllTimersAsync();

    expect(await pending).toEqual({ status: 'queued' });
    expect(h.rpc).toHaveBeenCalledTimes(3);
    expect(h.writes).toEqual([
      {
        table: 'credit_refund_retries',
        op: 'upsert',
        payload: {
          account_id: 'acct-1',
          feature: 'listing_parse',
          burn_key: 'listing_parse:k2',
          reason: 'e-Khata read failed',
          last_error: '[refundBurn] RPC failed: db down',
        },
        options: { onConflict: 'account_id,burn_key' },
        filters: [],
      },
    ]);
  });
});

describe('[INB-027] retryQueuedRefunds', () => {
  it('reads only open refunds under the attempt limit', async () => {
    await retryQueuedRefunds();

    expect(h.selectFilters).toEqual([
      ['is:resolved_at', null],
      ['lt:attempts', QUEUED_REFUND_ATTEMPT_LIMIT],
    ]);
  });

  it('resolves a refund that now succeeds and counts one that still fails', async () => {
    h.queued = [
      {
        id: 'q1',
        account_id: 'a1',
        feature: 'contact_parse',
        burn_key: 'k1',
        attempts: 0,
      },
      {
        id: 'q2',
        account_id: 'a2',
        feature: 'listing_parse',
        burn_key: 'k2',
        attempts: 4,
      },
    ];
    h.rpc
      .mockResolvedValueOnce({ data: [{ refunded: 4 }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'still down' } });

    const result = await retryQueuedRefunds();

    expect(result).toEqual({ resolved: 1, failed: 1 });
    expect(h.writes[0]).toMatchObject({
      op: 'update',
      filters: [['id', 'q1']],
      payload: { attempts: 1, last_error: null },
    });
    expect(h.writes[0].payload.resolved_at).toEqual(expect.any(String));
    expect(h.writes[1]).toMatchObject({
      op: 'update',
      filters: [['id', 'q2']],
      payload: {
        attempts: 5,
        last_error: '[refundBurn] RPC failed: still down',
      },
    });
    expect(h.writes[1].payload).not.toHaveProperty('resolved_at');
  });
});

describe('[INB-027] the keyed refund migrations', () => {
  const refund = readFileSync(
    'supabase/migrations/20261004084500_credit_burn_keys.sql',
    'utf8'
  );
  const burn = readFileSync(
    'supabase/migrations/20261004084600_burn_credits_tx_burn_key.sql',
    'utf8'
  );
  const refundFn = refund.slice(
    refund.indexOf('FUNCTION public.refund_burn_tx(')
  );

  it('refunds only the rows burned under the key, each once', () => {
    expect(refundFn).toContain('ct.burn_key = p_burn_key');
    expect(refundFn).toContain("rf.description = 'refund:' || ct.id::text");
    expect(refundFn).toContain("'refund:' || r.id::text");
  });

  it('never tops up purchased credits beyond what the key burned', () => {
    expect(refundFn).not.toContain('v_fallback');
    expect(refundFn).not.toContain('p_cost');
  });

  it('is callable only by the service role', () => {
    expect(refund).toContain(
      'REVOKE EXECUTE ON FUNCTION public.refund_burn_tx(UUID, TEXT, TEXT)\n  FROM PUBLIC, anon, authenticated;'
    );
    expect(refund).toContain(
      'ALTER TABLE credit_refund_retries ENABLE ROW LEVEL SECURITY;'
    );
  });

  it('keeps a keyed burn out of the description the credits history shows', () => {
    expect(burn).toContain("v_description := p_feature || ' burn';");
    expect(burn).not.toMatch(/v_description := CASE/);
    expect(burn.match(/, burn_key\)\n\s+VALUES \(/g)).toHaveLength(5);
    expect(burn.match(/v_description, p_retry_key\);/g)).toHaveLength(5);
    expect(burn).toContain(
      "AND (burn_key = p_retry_key OR description = 'retry:' || p_retry_key)"
    );
  });
});
