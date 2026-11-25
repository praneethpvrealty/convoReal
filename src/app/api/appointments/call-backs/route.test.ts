import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  filters: [] as Array<[string, string, unknown]>,
  rows: [] as unknown[],
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: async (role: string) => {
    expect(role).toBe('agent');
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        state.filters.push(['eq', column, value]);
        return builder;
      },
      gte: (column: string, value: unknown) => {
        state.filters.push(['gte', column, value]);
        return builder;
      },
      order: () => builder,
      limit: async () => ({ data: state.rows, error: null }),
    };
    return {
      accountId: 'acct-1',
      userId: 'user-1',
      supabase: { from: () => builder },
    };
  },
  toErrorResponse: (err: unknown) => {
    throw err;
  },
}));

import { GET } from './route';

describe('GET /api/appointments/call-backs', () => {
  beforeEach(() => {
    state.filters = [];
    state.rows = [{ id: 'a1', start_time: '2026-11-25T10:00:00.000Z' }];
  });

  it('[CAL-024] lists the caller own open Call events in this account', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: state.rows });
    expect(state.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'account_id', 'acct-1'],
        ['eq', 'user_id', 'user-1'],
        ['eq', 'event_type', 'call'],
        ['eq', 'status', 'scheduled'],
      ])
    );
    expect(
      state.filters.some(([op, col]) => op === 'gte' && col === 'start_time')
    ).toBe(true);
  });
});
