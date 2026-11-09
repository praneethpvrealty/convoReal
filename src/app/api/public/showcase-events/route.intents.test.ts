import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Shortlist and WhatsApp taps on the public beacon: both are admitted
 * as events, and for a visitor the showcase knows each one is filed as
 * an enquiry on the listing — but only a listing in the same account,
 * since the beacon is public and the property id comes from the
 * browser. The Supabase admin client is stubbed; rate limiting runs
 * for real.
 */

interface QueuedResponse {
  data?: unknown;
  error?: unknown;
}

let queues: Record<string, QueuedResponse[]>;
let inserts: Array<{ table: string; rows: unknown }>;
let upserts: Array<{ table: string; rows: unknown; options: unknown }>;
let inFilters: Array<{ table: string; column: string; values: unknown }>;
let eqFilters: Array<{ table: string; column: string; value: unknown }>;
let identity: QueuedResponse;

const { getCurrentAccount } = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({ getCurrentAccount }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc() {
      return Promise.resolve({
        data: identity.data,
        error: identity.error ?? null,
      });
    },
    from(table: string) {
      const response = (queues[table] ?? []).shift() ?? {
        data: null,
        error: null,
      };
      const builder: { [k: string]: (...args: unknown[]) => unknown } = {
        select: () => builder,
        eq: (column: unknown, value: unknown) => {
          eqFilters.push({ table, column: String(column), value });
          return builder;
        },
        is: () => builder,
        in: (column: unknown, values: unknown) => {
          inFilters.push({ table, column: String(column), values });
          return builder;
        },
        update: () => builder,
        insert: (rows: unknown) => {
          inserts.push({ table, rows });
          return Promise.resolve({ error: null });
        },
        upsert: (rows: unknown, options: unknown) => {
          upserts.push({ table, rows, options });
          return Promise.resolve({ error: null });
        },
        maybeSingle: () => Promise.resolve(response),
        then: (resolve: unknown, reject: unknown) =>
          Promise.resolve(response).then(
            resolve as (v: unknown) => unknown,
            reject as (v: unknown) => unknown
          ),
      };
      return builder;
    },
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

const { POST } = await import('./route');

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTACT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROPERTY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const FOREIGN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

let sessionCounter = 0;

function beacon(events: Array<Record<string, unknown>>) {
  return new Request('http://localhost/api/public/showcase-events', {
    method: 'POST',
    body: JSON.stringify({
      account_id: ACCOUNT,
      session_key: `intent-${++sessionCounter}`,
      events,
    }),
  }) as never;
}

function insertedEvents() {
  const batch = inserts.find((i) => i.table === 'showcase_events');
  return (batch?.rows ?? []) as Array<{
    event_type: string;
    property_id: string | null;
    metadata: Record<string, unknown>;
  }>;
}

function enquiryUpserts() {
  return upserts
    .filter((u) => u.table === 'contact_property_inquiries')
    .flatMap(
      (u) =>
        u.rows as Array<{
          account_id: string;
          contact_id: string;
          property_id: string;
          inquiry_source: string;
        }>
    );
}

beforeEach(() => {
  queues = {
    accounts: [{ data: { id: ACCOUNT }, error: null }],
    properties: [{ data: [{ id: PROPERTY }], error: null }],
  };
  inserts = [];
  upserts = [];
  inFilters = [];
  eqFilters = [];
  identity = { data: [{ contact_id: null, via_contact_id: null }] };
  getCurrentAccount.mockRejectedValue(new Error('Unauthorized'));
});

describe('[PRP-058] showcase-events beacon — shortlist and WhatsApp intents', () => {
  it('records a shortlist add or remove with its action and a WhatsApp tap', async () => {
    await POST(
      beacon([
        {
          type: 'shortlist',
          property_id: PROPERTY,
          metadata: { action: 'add' },
        },
        {
          type: 'shortlist',
          property_id: PROPERTY,
          metadata: { action: 'remove' },
        },
        { type: 'whatsapp_click', property_id: PROPERTY },
      ])
    );
    const events = insertedEvents();
    expect(events.map((e) => e.event_type)).toEqual([
      'shortlist',
      'shortlist',
      'whatsapp_click',
    ]);
    expect(events[0].metadata).toEqual({ action: 'add' });
    expect(events[1].metadata).toEqual({ action: 'remove' });
  });

  it('inserts intent rows apart from the visit\u2019s activity rows', async () => {
    await POST(
      beacon([
        { type: 'view_property', property_id: PROPERTY },
        {
          type: 'shortlist',
          property_id: PROPERTY,
          metadata: { action: 'add' },
        },
      ])
    );
    const batches = inserts.filter((i) => i.table === 'showcase_events');
    expect(batches).toHaveLength(2);
    expect(
      (batches[0].rows as Array<{ event_type: string }>).map(
        (r) => r.event_type
      )
    ).toEqual(['view_property']);
    expect(
      (batches[1].rows as Array<{ event_type: string }>).map(
        (r) => r.event_type
      )
    ).toEqual(['shortlist']);
  });

  it('drops a shortlist event without a known action', async () => {
    await POST(
      beacon([
        { type: 'shortlist', property_id: PROPERTY, metadata: { action: 'x' } },
        { type: 'shortlist', property_id: PROPERTY },
      ])
    );
    expect(inserts.find((i) => i.table === 'showcase_events')).toBeUndefined();
  });

  it('leaves an anonymous visitor as activity only, never an enquiry', async () => {
    await POST(
      beacon([
        {
          type: 'shortlist',
          property_id: PROPERTY,
          metadata: { action: 'add' },
        },
        { type: 'whatsapp_click', property_id: PROPERTY },
      ])
    );
    expect(enquiryUpserts()).toEqual([]);
  });

  it('files a known visitor’s shortlist as a Website Shortlist enquiry on the listing', async () => {
    identity = { data: [{ contact_id: CONTACT, via_contact_id: null }] };
    await POST(
      beacon([
        {
          type: 'shortlist',
          property_id: PROPERTY,
          metadata: { action: 'add' },
        },
      ])
    );
    expect(enquiryUpserts()).toEqual([
      {
        account_id: ACCOUNT,
        contact_id: CONTACT,
        property_id: PROPERTY,
        inquiry_source: 'Website Shortlist',
      },
    ]);
    expect(upserts[0].options).toMatchObject({
      onConflict: 'contact_id,property_id',
      ignoreDuplicates: true,
    });
  });

  it('files a known visitor’s WhatsApp tap as a Website WhatsApp enquiry, once per listing', async () => {
    identity = { data: [{ contact_id: CONTACT, via_contact_id: null }] };
    await POST(
      beacon([
        { type: 'whatsapp_click', property_id: PROPERTY },
        { type: 'whatsapp_click', property_id: PROPERTY },
      ])
    );
    const rows = enquiryUpserts();
    expect(rows).toHaveLength(1);
    expect(rows[0].inquiry_source).toBe('Website WhatsApp');
  });

  it('does not treat removing from the shortlist as an enquiry', async () => {
    identity = { data: [{ contact_id: CONTACT, via_contact_id: null }] };
    await POST(
      beacon([
        {
          type: 'shortlist',
          property_id: PROPERTY,
          metadata: { action: 'remove' },
        },
      ])
    );
    expect(enquiryUpserts()).toEqual([]);
  });

  it('files only a listing the showcase publishes: in the account, published and Available', async () => {
    identity = { data: [{ contact_id: CONTACT, via_contact_id: null }] };
    await POST(beacon([{ type: 'whatsapp_click', property_id: PROPERTY }]));
    const propertyFilters = eqFilters.filter((f) => f.table === 'properties');
    expect(propertyFilters).toEqual(
      expect.arrayContaining([
        { table: 'properties', column: 'account_id', value: ACCOUNT },
        { table: 'properties', column: 'is_published', value: true },
        { table: 'properties', column: 'status', value: 'Available' },
      ])
    );
  });

  it('never files a listing that belongs to another account', async () => {
    identity = { data: [{ contact_id: CONTACT, via_contact_id: null }] };
    queues.properties = [{ data: [], error: null }];
    await POST(
      beacon([
        {
          type: 'shortlist',
          property_id: FOREIGN,
          metadata: { action: 'add' },
        },
      ])
    );
    expect(inFilters).toContainEqual({
      table: 'properties',
      column: 'id',
      values: [FOREIGN],
    });
    expect(enquiryUpserts()).toEqual([]);
  });
});
