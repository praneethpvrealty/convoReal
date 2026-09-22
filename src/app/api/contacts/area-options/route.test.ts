import { beforeEach, describe, expect, it, vi } from 'vitest';

let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
let rpcResult: { data: unknown; error: { message: string } | null };
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
          return rpcResult;
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

beforeEach(() => {
  rpcCalls = [];
  denied = false;
  rpcResult = { data: [], error: null };
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

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(rpcCalls).toEqual([
      { fn: 'contact_area_options', args: { p_account_id: 'acc-1' } },
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
        count: 6,
      }),
    ]);
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
