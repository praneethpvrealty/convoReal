import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/contacts/[id]/calls — a call log is a contact touch, so it
 * bumps contacts.last_contacted_at, but only forward: back-logging an
 * old call must not rewind a fresher touch.
 */

interface QueuedResponse {
  data?: unknown;
  error?: unknown;
}

let queues: Record<string, QueuedResponse[]>;
let inserts: Array<{ table: string; row: unknown }>;
let updates: Array<{ table: string; row: unknown }>;

function makeDb() {
  return {
    from(table: string) {
      const builder: { [k: string]: (...args: unknown[]) => unknown } = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        insert: (row: unknown) => {
          inserts.push({ table, row });
          return builder;
        },
        update: (row: unknown) => {
          updates.push({ table, row });
          return builder;
        },
        single: () => Promise.resolve((queues[table] ?? []).shift() ?? { data: null, error: null }),
        then: (resolve: unknown, reject: unknown) =>
          Promise.resolve({ data: null, error: null }).then(
            resolve as (v: unknown) => unknown,
            reject as (v: unknown) => unknown
          ),
      };
      return builder;
    },
  };
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    supabase: makeDb(),
    accountId: 'acc-1',
    userId: 'user-1',
  }),
  toErrorResponse: (err: unknown) =>
    Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }),
}));

import { POST } from './route';

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://test/api/contacts/c-1/calls', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: 'c-1' });

beforeEach(() => {
  queues = {};
  inserts = [];
  updates = [];
});

describe('POST /api/contacts/[id]/calls', () => {
  it('creates the log and bumps last_contacted_at for a first touch', async () => {
    queues['contacts'] = [{ data: { id: 'c-1', last_contacted_at: null } }];
    queues['contact_call_logs'] = [{ data: { id: 'call-1' } }];

    const res = await POST(makeRequest({ outcome: 'connected' }) as never, { params });
    expect(res.status).toBe(201);
    expect(inserts).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe('contacts');
  });

  it('moves last_contacted_at forward for a newer call', async () => {
    queues['contacts'] = [
      { data: { id: 'c-1', last_contacted_at: '2026-01-01T00:00:00.000Z' } },
    ];
    queues['contact_call_logs'] = [{ data: { id: 'call-1' } }];

    const calledAt = '2026-02-01T00:00:00.000Z';
    const res = await POST(
      makeRequest({ outcome: 'no_answer', called_at: calledAt }) as never,
      { params }
    );
    expect(res.status).toBe(201);
    expect(updates).toEqual([
      { table: 'contacts', row: { last_contacted_at: calledAt } },
    ]);
  });

  it('does not rewind last_contacted_at when back-logging an older call', async () => {
    queues['contacts'] = [
      { data: { id: 'c-1', last_contacted_at: '2026-02-01T00:00:00.000Z' } },
    ];
    queues['contact_call_logs'] = [{ data: { id: 'call-1' } }];

    const res = await POST(
      makeRequest({ outcome: 'connected', called_at: '2026-01-01T00:00:00.000Z' }) as never,
      { params }
    );
    expect(res.status).toBe(201);
    expect(inserts).toHaveLength(1);
    expect(updates).toHaveLength(0);
  });

  it('rejects an unknown outcome before touching the database', async () => {
    const res = await POST(makeRequest({ outcome: 'ghosted' }) as never, { params });
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
