import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DELETE /api/contacts/[id]/inquiries/[propertyId] — the correction an
 * agent reaches for when a portal lead was filed against the wrong
 * listing. Dropping the junction row and clearing the contact's headline
 * pointer are one action: leaving the pointer behind is what made a
 * "removed" interest keep showing up as the listing they contacted about.
 */

interface QueuedResponse {
  data?: unknown;
  error?: unknown;
}

let queues: Record<string, QueuedResponse[]>;
let updates: Array<{ table: string; row: unknown }>;
let deletes: string[];

function next(table: string): QueuedResponse {
  return (queues[table] ?? []).shift() ?? { data: null, error: null };
}

function makeDb() {
  return {
    from(table: string) {
      const builder: { [k: string]: (...args: unknown[]) => unknown } = {
        select: () => builder,
        eq: () => builder,
        update: (row: unknown) => {
          updates.push({ table, row });
          return builder;
        },
        delete: () => {
          deletes.push(table);
          return builder;
        },
        maybeSingle: () => Promise.resolve(next(table)),
        then: (resolve: unknown, reject: unknown) =>
          Promise.resolve(next(table)).then(
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
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    ),
}));

import { DELETE } from './route';

const params = Promise.resolve({ id: 'c-1', propertyId: 'p-1' });
const request = new Request('http://test/api/contacts/c-1/inquiries/p-1', {
  method: 'DELETE',
});

beforeEach(() => {
  queues = {};
  updates = [];
  deletes = [];
});

describe('DELETE /api/contacts/[id]/inquiries/[propertyId]', () => {
  it('clears the pointer along with the junction row', async () => {
    queues['contacts'] = [
      { data: { id: 'c-1', last_inquired_property_id: 'p-1' } },
      { data: [{ id: 'c-1' }] },
    ];
    queues['contact_property_inquiries'] = [{ data: [{ contact_id: 'c-1' }] }];

    const res = await DELETE(request as never, { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      removed: true,
      pointerCleared: true,
    });
    expect(deletes).toEqual(['contact_property_inquiries']);
    expect(updates[0]).toMatchObject({
      table: 'contacts',
      row: { last_inquired_property_id: null },
    });
  });

  it('clears a pointer-only tag, which the lead webhook can set without a row', async () => {
    queues['contacts'] = [
      { data: { id: 'c-1', last_inquired_property_id: 'p-1' } },
      { data: [{ id: 'c-1' }] },
    ];
    queues['contact_property_inquiries'] = [{ data: [] }];

    const res = await DELETE(request as never, { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data.pointerCleared).toBe(true);
  });

  it('leaves a pointer that names a different listing alone', async () => {
    queues['contacts'] = [
      { data: { id: 'c-1', last_inquired_property_id: 'p-other' } },
    ];
    queues['contact_property_inquiries'] = [{ data: [{ contact_id: 'c-1' }] }];

    const res = await DELETE(request as never, { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data.pointerCleared).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('reports a tag that is already gone rather than claiming a correction', async () => {
    queues['contacts'] = [
      { data: { id: 'c-1', last_inquired_property_id: null } },
    ];
    queues['contact_property_inquiries'] = [{ data: [] }];

    const res = await DELETE(request as never, { params });
    expect(res.status).toBe(404);
    expect(updates).toHaveLength(0);
  });

  it('refuses a contact from another account', async () => {
    queues['contacts'] = [{ data: null }];

    const res = await DELETE(request as never, { params });
    expect(res.status).toBe(404);
    expect(deletes).toHaveLength(0);
  });
});
