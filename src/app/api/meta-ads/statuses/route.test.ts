import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  filters: [] as Array<[string, string, unknown]>,
  rows: [] as Array<{ property_id: string; status: string }>,
  fromCalls: 0,
  denied: false,
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => {
    if (state.denied) throw new Error('Unauthorized');
    return { accountId: 'acct-1' };
  },
  toErrorResponse: (err: unknown) =>
    Response.json({ error: String(err) }, { status: 401 }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      state.fromCalls += 1;
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          state.filters.push(['eq', column, value]);
          return builder;
        },
        in: (column: string, value: unknown) => {
          state.filters.push(['in', column, value]);
          if (column === 'property_id')
            return Promise.resolve({ data: state.rows, error: null });
          return builder;
        },
      };
      return builder;
    },
  }),
}));

import { GET } from './route';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function get(ids: string) {
  return GET(
    new Request(`http://test/api/meta-ads/statuses?property_ids=${ids}`)
  );
}

beforeEach(() => {
  state.filters.length = 0;
  state.rows = [];
  state.fromCalls = 0;
  state.denied = false;
});

describe('GET /api/meta-ads/statuses', () => {
  it('[PRP-032] scopes the read to the caller account and the asked listings', async () => {
    state.rows = [
      { property_id: A, status: 'PAUSED' },
      { property_id: A, status: 'ACTIVE' },
      { property_id: B, status: 'PAUSED' },
    ];
    const res = await get(`${A},${B}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { [A]: 'ACTIVE', [B]: 'PAUSED' },
    });
    expect(state.filters).toContainEqual(['eq', 'account_id', 'acct-1']);
    expect(state.filters).toContainEqual([
      'in',
      'status',
      ['ACTIVE', 'PAUSED'],
    ]);
    expect(state.filters).toContainEqual(['in', 'property_id', [A, B]]);
  });

  it('[PRP-032] drops ids that are not uuids and skips the query when none remain', async () => {
    const res = await get("abc,1');drop");
    expect(await res.json()).toEqual({ data: {} });
    expect(state.fromCalls).toBe(0);
  });

  it('[PRP-032] refuses a caller without an account', async () => {
    state.denied = true;
    const res = await get(A);
    expect(res.status).toBe(401);
    expect(state.fromCalls).toBe(0);
  });
});
