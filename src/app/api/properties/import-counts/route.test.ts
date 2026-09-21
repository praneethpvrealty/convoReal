import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  authError: null as Error | null,
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => {
    if (state.authError) throw state.authError;
    return { accountId: 'acct-1', supabase: { rpc: state.rpc } };
  },
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: 'Request failed' },
      { status: error === state.authError ? 401 : 500 }
    ),
}));

import { GET } from './route';

beforeEach(() => {
  state.authError = null;
  state.rpc.mockReset();
});

describe('GET /api/properties/import-counts', () => {
  it('asks the membership-guarded RPC for the session account only', async () => {
    state.rpc.mockResolvedValue({
      data: [
        { property_id: 'p1', import_count: 2 },
        { property_id: 'p2', import_count: 0 },
      ],
      error: null,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith('inventory_import_counts', {
      target_account_id: 'acct-1',
    });
    expect(await res.json()).toEqual({ data: { p1: 2 } });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('reports an RPC failure without inventing counts', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.rpc.mockResolvedValue({ data: null, error: new Error('boom') });
    const res = await GET();
    expect(res.status).toBe(500);
    spy.mockRestore();
  });

  it('refuses without a session', async () => {
    state.authError = new Error('no session');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
