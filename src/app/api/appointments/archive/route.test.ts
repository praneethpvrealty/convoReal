import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  calls: [] as Array<{
    payload: Record<string, unknown>;
    filters: Array<[string, string, unknown]>;
  }>,
  rows: [] as Array<{ id: string; status: string }>,
  readOnly: false,
}));

vi.mock('@/lib/auth/account', () => ({
  requireWriteRole: async () => {
    if (state.readOnly) {
      throw new Error('Read-only members cannot make changes.');
    }
    return {
      accountId: 'acct-1',
      supabase: {
        from: () => {
          const call = {
            payload: {} as Record<string, unknown>,
            filters: [] as Array<[string, string, unknown]>,
          };
          const builder = {
            update: (payload: Record<string, unknown>) => {
              call.payload = payload;
              state.calls.push(call);
              return builder;
            },
            eq: (column: string, value: unknown) => {
              call.filters.push(['eq', column, value]);
              return builder;
            },
            neq: (column: string, value: unknown) => {
              call.filters.push(['neq', column, value]);
              return builder;
            },
            in: (column: string, value: unknown) => {
              call.filters.push(['in', column, value]);
              return builder;
            },
            select: async () => {
              const ids = call.filters.find(
                ([op]) => op === 'in'
              )?.[2] as string[];
              const skipScheduled = call.filters.some(
                ([op, column]) => op === 'neq' && column === 'status'
              );
              return {
                data: state.rows
                  .filter((row) => ids.includes(row.id))
                  .filter((row) => !skipScheduled || row.status !== 'scheduled')
                  .map((row) => ({ id: row.id })),
                error: null,
              };
            },
          };
          return builder;
        },
      },
    };
  },
  toErrorResponse: (err: unknown) =>
    Response.json({ error: String(err) }, { status: 403 }),
}));

import { POST } from './route';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function post(body: unknown) {
  return POST(
    new Request('http://test/api/appointments/archive', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

describe('POST /api/appointments/archive', () => {
  beforeEach(() => {
    state.calls = [];
    state.readOnly = false;
    state.rows = [
      { id: id(1), status: 'completed' },
      { id: id(2), status: 'cancelled' },
      { id: id(3), status: 'scheduled' },
    ];
  });

  it('[CAL-011] archives only finished events of the caller’s account', async () => {
    const res = await post({ ids: [id(1), id(2), id(3)], archived: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ids).toEqual([id(1), id(2)]);
    expect(typeof body.data.archived_at).toBe('string');
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].payload).toEqual({
      archived_at: body.data.archived_at,
    });
    expect(state.calls[0].filters).toContainEqual([
      'eq',
      'account_id',
      'acct-1',
    ]);
    expect(state.calls[0].filters).toContainEqual([
      'neq',
      'status',
      'scheduled',
    ]);
  });

  it('[CAL-011] unarchives by clearing the stamp', async () => {
    const res = await post({ ids: [id(2)], archived: false });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      ids: [id(2)],
      archived_at: null,
    });
    expect(state.calls[0].payload).toEqual({ archived_at: null });
    expect(state.calls[0].filters).toContainEqual([
      'eq',
      'account_id',
      'acct-1',
    ]);
  });

  it('[CAL-011] writes a long list in bounded chunks', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => id(i + 10));
    state.rows = ids.map((value) => ({ id: value, status: 'completed' }));
    const res = await post({ ids, archived: true });
    expect(res.status).toBe(200);
    expect(
      state.calls.map(
        (call) =>
          (call.filters.find(([op]) => op === 'in')?.[2] as string[]).length
      )
    ).toEqual([100, 100, 50]);
    expect((await res.json()).data.ids).toHaveLength(250);
  });

  it('[CAL-011] refuses a read-only member without writing', async () => {
    state.readOnly = true;
    const res = await post({ ids: [id(1)], archived: true });
    expect(res.status).toBe(403);
    expect(state.calls).toHaveLength(0);
  });

  it('[CAL-011] rejects a malformed request without writing', async () => {
    for (const body of [
      {},
      { ids: [id(1)] },
      { ids: [], archived: true },
      { ids: ['not-a-uuid'], archived: true },
      { ids: Array.from({ length: 501 }, (_, i) => id(i)), archived: true },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
    }
    expect(state.calls).toHaveLength(0);
  });
});
