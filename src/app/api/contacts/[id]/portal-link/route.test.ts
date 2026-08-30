import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/contacts/[id]/portal-link — the agent's one-time assertion
 * that a portal ad IS one of their listings. property_portal_listings is
 * one-to-one per portal (migration 124), so the route refuses to point an
 * ad at a second listing, and asserting it settles every lead already
 * waiting on that ad rather than only the one under review.
 */

interface QueuedResponse {
  data?: unknown;
  error?: unknown;
}

let queues: Record<string, QueuedResponse[]>;
let upserts: Array<{ table: string; row: unknown }>;
let upsertOptions: unknown[];
let updates: Array<{ table: string; row: unknown }>;
let deletes: Array<{ table: string }>;
let rpcs: Array<{ fn: string; args: unknown }>;

function next(table: string): QueuedResponse {
  return (queues[table] ?? []).shift() ?? { data: null, error: null };
}

function makeDb() {
  return {
    from(table: string) {
      const builder: { [k: string]: (...args: unknown[]) => unknown } = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        update: (row: unknown) => {
          updates.push({ table, row });
          return builder;
        },
        delete: () => {
          deletes.push({ table });
          return builder;
        },
        upsert: (row: unknown, options?: unknown) => {
          upserts.push({ table, row });
          upsertOptions.push(options);
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
    rpc(fn: string, args: unknown) {
      rpcs.push({ fn, args });
      return {
        maybeSingle: () => Promise.resolve(next(`rpc:${fn}`)),
      };
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

import { DELETE, POST } from './route';

const params = Promise.resolve({ id: 'c-1' });

function makeDeleteRequest() {
  return new Request('http://test/api/contacts/c-1/portal-link', {
    method: 'DELETE',
  });
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://test/api/contacts/c-1/portal-link', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const HOUSING_LEAD = {
  id: 'c-1',
  lead_portal: 'housing',
  lead_portal_listing_id: '20327451',
};

beforeEach(() => {
  queues = {};
  upserts = [];
  upsertOptions = [];
  updates = [];
  deletes = [];
  rpcs = [];
});

describe('POST /api/contacts/[id]/portal-link', () => {
  it('maps the ad and tags every lead waiting on it', async () => {
    queues['contacts'] = [
      { data: HOUSING_LEAD },
      { data: [{ id: 'c-1' }, { id: 'c-2' }, { id: 'c-3' }] },
      { data: [{ id: 'c-1' }, { id: 'c-2' }, { id: 'c-3' }] },
    ];
    queues['properties'] = [
      { data: { id: 'p-1', title: 'Koramangala 4 BHK' } },
    ];
    queues['property_portal_listings'] = [{ data: null }, { data: null }];
    queues['contact_property_inquiries'] = [{ data: null }];

    const res = await POST(makeRequest({ propertyId: 'p-1' }) as never, {
      params,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      portal: 'housing',
      portalListingId: '20327451',
      propertyId: 'p-1',
      taggedContacts: 3,
    });

    // The mapping itself, carrying the portal's own id.
    expect(upserts[0]).toMatchObject({
      table: 'property_portal_listings',
      row: {
        portal: 'housing',
        portal_listing_id: '20327451',
        property_id: 'p-1',
      },
    });
    // Every waiting lead re-pointed at the asserted listing…
    expect(updates[0]).toMatchObject({
      table: 'contacts',
      row: { last_inquired_property_id: 'p-1' },
    });
    // …and given the junction row the inventory side reads.
    expect(upserts[1].table).toBe('contact_property_inquiries');
    expect(upserts[1].row).toHaveLength(3);
    // An interest that predates the mapping keeps its own source and
    // date, so unmapping can tell the two apart.
    expect(upsertOptions[1]).toMatchObject({ ignoreDuplicates: true });
  });

  it('refuses to point one ad at a second listing', async () => {
    queues['contacts'] = [{ data: HOUSING_LEAD }];
    queues['properties'] = [{ data: { id: 'p-2', title: 'HSR Bungalow' } }];
    queues['property_portal_listings'] = [
      {
        data: {
          id: 'link-1',
          property_id: 'p-1',
          status: 'active',
          properties: { title: 'Koramangala 4 BHK' },
        },
      },
    ];

    const res = await POST(makeRequest({ propertyId: 'p-2' }) as never, {
      params,
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('PORTAL_ID_TAKEN');
    expect(body.error).toContain('Koramangala 4 BHK');
    expect(upserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('re-asserting the same pair is not a conflict', async () => {
    queues['contacts'] = [
      { data: HOUSING_LEAD },
      { data: [{ id: 'c-1' }] },
      { data: [{ id: 'c-1' }] },
    ];
    queues['properties'] = [
      { data: { id: 'p-1', title: 'Koramangala 4 BHK' } },
    ];
    queues['property_portal_listings'] = [
      { data: { property_id: 'p-1' } },
      { data: null },
    ];
    queues['contact_property_inquiries'] = [{ data: null }];

    const res = await POST(makeRequest({ propertyId: 'p-1' }) as never, {
      params,
    });
    expect(res.status).toBe(200);
  });

  it('has nothing to map when the lead quoted no ad id', async () => {
    queues['contacts'] = [
      { data: { id: 'c-1', lead_portal: null, lead_portal_listing_id: null } },
    ];

    const res = await POST(makeRequest({ propertyId: 'p-1' }) as never, {
      params,
    });
    expect(res.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it('rejects a property from another account', async () => {
    queues['contacts'] = [{ data: HOUSING_LEAD }];
    queues['properties'] = [{ data: null }];

    const res = await POST(
      makeRequest({ propertyId: 'p-elsewhere' }) as never,
      { params }
    );
    expect(res.status).toBe(404);
    expect(upserts).toHaveLength(0);
  });
  it('takes the ad from a listing that is no longer advertised', async () => {
    queues['contacts'] = [
      { data: HOUSING_LEAD },
      { data: [{ id: 'c-1' }] },
      { data: [{ id: 'c-1' }] },
    ];
    queues['properties'] = [{ data: { id: 'p-2', title: 'HSR Bungalow' } }];
    queues['property_portal_listings'] = [
      {
        data: {
          id: 'link-1',
          property_id: 'p-1',
          status: 'removed',
          properties: { title: 'Koramangala 4 BHK' },
        },
      },
      { data: [{ id: 'link-1' }] },
      { data: null },
    ];
    queues['contact_property_inquiries'] = [{ data: null }];

    const res = await POST(makeRequest({ propertyId: 'p-2' }) as never, {
      params,
    });
    expect(res.status).toBe(200);
    // The dead row gives the id up rather than blocking the assertion —
    // uq_portal_listing_identity would reject two holders of one ad.
    expect(updates[0]).toMatchObject({
      table: 'property_portal_listings',
      row: { portal_listing_id: null },
    });
    expect(upserts[0]).toMatchObject({
      table: 'property_portal_listings',
      row: { property_id: 'p-2', portal_listing_id: '20327451' },
    });
  });
});

describe('DELETE /api/contacts/[id]/portal-link', () => {
  it('undoes the mapping in one transactional call', async () => {
    queues['contacts'] = [{ data: HOUSING_LEAD }];
    queues['rpc:unmap_portal_ad'] = [
      { data: { property_id: 'p-1', untagged_contacts: 2 } },
    ];

    const res = await DELETE(makeDeleteRequest() as never, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      portal: 'housing',
      portalListingId: '20327451',
      propertyId: 'p-1',
      untaggedContacts: 2,
    });

    // Release, untag and junction cleanup commit together, and the
    // contacts are reached without an unbounded id list.
    expect(rpcs).toEqual([
      {
        fn: 'unmap_portal_ad',
        args: {
          p_account_id: 'acc-1',
          p_portal: 'housing',
          p_portal_listing_id: '20327451',
        },
      },
    ]);
    expect(updates).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });

  it('reports an ad that was never mapped', async () => {
    queues['contacts'] = [{ data: HOUSING_LEAD }];
    queues['rpc:unmap_portal_ad'] = [{ data: null }];

    const res = await DELETE(makeDeleteRequest() as never, { params });
    expect(res.status).toBe(404);
  });

  it('has nothing to unmap when the lead quoted no ad id', async () => {
    queues['contacts'] = [
      { data: { id: 'c-1', lead_portal: null, lead_portal_listing_id: null } },
    ];

    const res = await DELETE(makeDeleteRequest() as never, { params });
    expect(res.status).toBe(400);
    expect(rpcs).toHaveLength(0);
  });
});
