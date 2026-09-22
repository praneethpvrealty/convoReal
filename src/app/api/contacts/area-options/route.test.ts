import { beforeEach, describe, expect, it, vi } from 'vitest';

let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
let rpcResult: { data: unknown; error: { message: string } | null };
let countResult: { data: unknown; error: { message: string } | null };
let denied = false;

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => {
    if (denied) throw new Error('Unauthorized');
    return {
      accountId: 'acc-1',
      userId: 'user-1',
      supabase: {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          rpcCalls.push({ fn, args });
          return fn === 'contact_area_group_counts' ? countResult : rpcResult;
        },
      },
    };
  },
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 401 }
    ),
}));

import { GET } from './route';
import { areaVariantKey as rpcKey } from '@/lib/contacts/area-variants';

beforeEach(() => {
  rpcCalls = [];
  denied = false;
  rpcResult = { data: [], error: null };
  countResult = { data: [], error: null };
});

describe('GET /api/contacts/area-options', () => {
  it('[CTM-007] reads the account-scoped SQL aggregate and groups spellings', async () => {
    rpcResult = {
      data: [
        { area: 'Brookefield', n: '4' },
        { area: 'Brookfield', n: 2 },
        { area: 'AECS Layout', n: 1 },
        { area: null, n: 3 },
      ],
      error: null,
    };
    countResult = {
      data: [
        { key: rpcKey('Brookefield'), n: '5' },
        { key: rpcKey('AECS Layout'), n: 1 },
      ],
      error: null,
    };

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(rpcCalls).toEqual([
      { fn: 'contact_area_options', args: { p_account_id: 'acc-1' } },
      {
        fn: 'contact_area_group_counts',
        args: {
          p_account_id: 'acc-1',
          p_groups: [
            { key: rpcKey('AECS Layout'), variants: ['AECS Layout'] },
            {
              key: rpcKey('Brookefield'),
              variants: ['Brookefield', 'Brookfield'],
            },
          ],
        },
      },
    ]);
    expect(body.data).toEqual([
      expect.objectContaining({
        label: 'AECS Layout',
        variants: ['AECS Layout'],
        count: 1,
      }),
      expect.objectContaining({
        label: 'Brookefield',
        variants: ['Brookefield', 'Brookfield'],
        count: 5,
      }),
    ]);
  });

  it('skips the second pass when no locality is stored', async () => {
    const res = await GET();
    expect(await res.json()).toEqual({ data: [] });
    expect(rpcCalls.map((c) => c.fn)).toEqual(['contact_area_options']);
  });

  it('surfaces a failure of the second pass as a 500', async () => {
    rpcResult = { data: [{ area: 'Whitefield', n: 1 }], error: null };
    countResult = { data: null, error: { message: 'count boom' } };
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'count boom' });
  });

  it('surfaces a database error as a 500', async () => {
    rpcResult = { data: null, error: { message: 'boom' } };
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'boom' });
  });

  it('reports an auth failure through toErrorResponse', async () => {
    denied = true;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(rpcCalls).toEqual([]);
  });
});
