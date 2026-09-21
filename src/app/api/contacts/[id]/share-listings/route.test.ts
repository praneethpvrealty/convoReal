import { beforeEach, describe, expect, it, vi } from 'vitest';

interface QueuedResponse {
  data?: unknown;
  error?: unknown;
}

let queues: Record<string, QueuedResponse[]>;
let upserts: Array<{ table: string; rows: unknown }>;
let adminQueues: Record<string, QueuedResponse[]>;
let adminUpserts: Array<{ table: string; rows: unknown }>;

function next(store: Record<string, QueuedResponse[]>, table: string) {
  return (store[table] ?? []).shift() ?? { data: null, error: null };
}

function makeDb(
  store: Record<string, QueuedResponse[]>,
  sink: Array<{ table: string; rows: unknown }>
) {
  return {
    from(table: string) {
      const builder: { [k: string]: (...args: unknown[]) => unknown } = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        upsert: (rows: unknown) => {
          sink.push({ table, rows });
          return builder;
        },
        maybeSingle: () => Promise.resolve(next(store, table)),
        then: (resolve: unknown, reject: unknown) =>
          Promise.resolve(next(store, table)).then(
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
    supabase: makeDb(queues, upserts),
    accountId: 'acc-1',
    userId: 'user-1',
  }),
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/buyer/auth', () => ({
  buyerAdmin: () => makeDb(adminQueues, adminUpserts),
}));

import { GET, POST } from './route';

const params = Promise.resolve({ id: 'c-1' });

function get(query = '') {
  return new Request(
    `http://test/api/contacts/c-1/share-listings${query}`
  ) as never;
}

function post(body: unknown) {
  return new Request('http://test/api/contacts/c-1/share-listings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

const contact = {
  id: 'c-1',
  name: 'Natarajan',
  phone: '+919524872601',
  classification: 'Buyer',
};

beforeEach(() => {
  queues = {};
  upserts = [];
  adminQueues = {};
  adminUpserts = [];
  process.env.NEXT_PUBLIC_SITE_URL = 'https://convoreal.com';
});

describe('GET /api/contacts/[id]/share-listings', () => {
  it('[CTM-004] reports a linked Portfolio account with the sign-in link and nudge', async () => {
    queues['contacts'] = [{ data: contact }];
    adminQueues['buyer_contact_links'] = [
      {
        data: [
          { buyer_user_id: 'bu-1', account_id: 'acc-1', contact_id: 'c-1' },
        ],
      },
    ];
    const res = await GET(get('?count=2'), { params });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.linked).toBe(true);
    expect(data.portfolio_url).toBe('https://convoreal.com/buyer/login');
    expect(data.nudge).toContain('These are saved in your Portfolio too');
    expect(data.nudge).toContain('https://convoreal.com/buyer/login');
  });

  it('[CTM-004] asks an unlinked buyer to sign in with this number', async () => {
    queues['contacts'] = [{ data: contact }];
    adminQueues['buyer_contact_links'] = [{ data: [] }];
    const res = await GET(get('?count=1'), { params });
    const { data } = await res.json();
    expect(data.linked).toBe(false);
    expect(data.nudge).toContain('sign in with this WhatsApp number');
  });

  it('refuses a contact from another account', async () => {
    queues['contacts'] = [{ data: null }];
    const res = await GET(get(), { params });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/contacts/[id]/share-listings', () => {
  it('[CTM-004] records the shares and saves them to the linked Portfolio shortlist', async () => {
    queues['contacts'] = [
      { data: contact },
      { data: contact },
      { data: contact },
    ];
    queues['properties'] = [{ data: [{ id: 'p-1' }, { id: 'p-2' }] }];
    queues['property_shares'] = [{ data: null }, { data: null }];
    adminQueues['buyer_contact_links'] = [
      {
        data: [
          { buyer_user_id: 'bu-1', account_id: 'acc-1', contact_id: 'c-1' },
        ],
      },
    ];
    adminQueues['buyer_shortlist_items'] = [{ data: [{ id: 's-1' }] }];

    const res = await POST(post({ property_ids: ['p-1', 'p-2', 'p-2'] }), {
      params,
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toEqual({
      recorded: 2,
      portfolio: {
        linked: true,
        saved: 1,
        url: 'https://convoreal.com/buyer/login',
      },
    });
    expect(upserts.map((u) => u.table)).toEqual([
      'property_shares',
      'property_shares',
    ]);
    expect(upserts[0].rows).toMatchObject({
      account_id: 'acc-1',
      property_id: 'p-1',
      contact_id: 'c-1',
      recipient_kind: 'buyer',
      created_by: 'user-1',
    });
    expect(adminUpserts).toEqual([
      {
        table: 'buyer_shortlist_items',
        rows: [
          {
            buyer_user_id: 'bu-1',
            account_id: 'acc-1',
            property_id: 'p-1',
            contact_id: 'c-1',
            source: 'shared',
          },
          {
            buyer_user_id: 'bu-1',
            account_id: 'acc-1',
            property_id: 'p-2',
            contact_id: 'c-1',
            source: 'shared',
          },
        ],
      },
    ]);
  });

  it('[CTM-004] still records the share for a buyer with no Portfolio account yet', async () => {
    queues['contacts'] = [{ data: contact }, { data: contact }];
    queues['properties'] = [{ data: [{ id: 'p-1' }] }];
    adminQueues['buyer_contact_links'] = [{ data: [] }];
    const res = await POST(post({ property_ids: ['p-1'] }), { params });
    const { data } = await res.json();
    expect(data.recorded).toBe(1);
    expect(data.portfolio).toMatchObject({ linked: false, saved: 0 });
    expect(adminUpserts).toEqual([]);
  });

  it('rejects an empty selection and properties outside the account', async () => {
    expect((await POST(post({ property_ids: [] }), { params })).status).toBe(
      400
    );
    queues['contacts'] = [{ data: contact }];
    queues['properties'] = [{ data: [] }];
    expect(
      (await POST(post({ property_ids: ['p-x'] }), { params })).status
    ).toBe(404);
  });

  it('refuses a contact from another account', async () => {
    queues['contacts'] = [{ data: null }];
    const res = await POST(post({ property_ids: ['p-1'] }), { params });
    expect(res.status).toBe(404);
  });
});
