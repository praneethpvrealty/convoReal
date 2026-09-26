import { beforeEach, describe, expect, it, vi } from 'vitest';

interface QueuedResponse {
  data?: unknown;
  error?: unknown;
}

let queues: Record<string, QueuedResponse[]>;
let inserts: Array<{ table: string; row: unknown }>;
let updates: Array<{ table: string; row: unknown }>;

function next(table: string): QueuedResponse {
  return (queues[table] ?? []).shift() ?? { data: null, error: null };
}

function makeDb() {
  return {
    from(table: string) {
      const builder: { [k: string]: (...args: unknown[]) => unknown } = {
        select: () => builder,
        eq: () => builder,
        neq: () => builder,
        order: () => builder,
        limit: () => builder,
        insert: (row: unknown) => {
          inserts.push({ table, row });
          return builder;
        },
        update: (row: unknown) => {
          updates.push({ table, row });
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

const sendPortfolioInvite = vi.fn();

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

vi.mock('@/lib/contacts/portfolio-invite', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/contacts/portfolio-invite')>();
  return {
    ...actual,
    sendPortfolioInvite: (...args: unknown[]) => sendPortfolioInvite(...args),
  };
});

import { GET, POST } from './route';

const params = Promise.resolve({ id: 'c-1' });

function get(query = '') {
  return new Request(
    `http://test/api/contacts/c-1/portfolio-invite${query}`
  ) as never;
}

function post(body: unknown) {
  return new Request('http://test/api/contacts/c-1/portfolio-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

const ownerBuyer = {
  id: 'c-1',
  name: 'Lakshmi Narayan',
  phone: '+919845012345',
  classification: 'Owner & Buyer',
};

beforeEach(() => {
  queues = {};
  inserts = [];
  updates = [];
  sendPortfolioInvite.mockReset();
});

describe('GET /api/contacts/[id]/portfolio-invite', () => {
  it('[CTM-011] drafts the owner invite first and lists both sides', async () => {
    queues['contacts'] = [{ data: ownerBuyer }];
    queues['accounts'] = [{ data: { name: 'Aryavarta Ventures' } }];
    queues['profiles'] = [{ data: { full_name: 'Praneeth' } }];

    const res = await GET(get(), { params });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.sides).toEqual(['owner', 'buyer']);
    expect(data.side).toBe('owner');
    expect(data.url).toMatch(/\/den\/login$/);
    expect(data.phone).toBe('+919845012345');
    expect(data.message).toContain('Hi Lakshmi 👋');
    expect(data.message).toContain('*Owner Portfolio*');
    expect(data.message).toContain(data.url);
  });

  it('[CTM-011] drafts the buyer invite when that side is picked', async () => {
    queues['contacts'] = [{ data: ownerBuyer }];

    const res = await GET(get('?side=buyer'), { params });
    const { data } = await res.json();
    expect(data.side).toBe('buyer');
    expect(data.url).toMatch(/\/buyer\/login$/);
    expect(data.message).toContain('properties matched to your requirements');
  });

  it('[CTM-011] drafts nothing for a contact Portfolio would not link', async () => {
    queues['contacts'] = [
      { data: { ...ownerBuyer, classification: 'Others' } },
    ];

    const res = await GET(get(), { params });
    const { data } = await res.json();
    expect(data).toMatchObject({
      sides: [],
      side: null,
      message: '',
      url: null,
    });
  });

  it('refuses a contact from another account', async () => {
    queues['contacts'] = [{ data: null }];
    const res = await GET(get(), { params });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/contacts/[id]/portfolio-invite', () => {
  it('[CTM-011] sends the chosen side from the business number by default', async () => {
    queues['contacts'] = [{ data: ownerBuyer }];
    sendPortfolioInvite.mockResolvedValue({
      success: true,
      delivery: 'free_text',
      side: 'buyer',
      message: 'm',
      url: 'u',
    });

    const res = await POST(post({ side: 'buyer' }), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data.delivery).toBe('free_text');
    expect(sendPortfolioInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        userId: 'user-1',
        side: 'buyer',
      })
    );
    expect(inserts).toHaveLength(0);
  });

  it('[CTM-011] reports a closed window as a conflict', async () => {
    queues['contacts'] = [{ data: ownerBuyer }];
    sendPortfolioInvite.mockResolvedValue({
      success: false,
      side: 'owner',
      message: 'm',
      url: 'u',
      error: 'window closed',
    });

    const res = await POST(post({ channel: 'business' }), { params });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('window closed');
  });

  it('[CTM-011] notes a personal WhatsApp invite on the timeline instead of sending', async () => {
    queues['contacts'] = [{ data: ownerBuyer }];
    queues['contact_notes'] = [{ data: null, error: null }];

    const res = await POST(post({ channel: 'personal', side: 'buyer' }), {
      params,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      delivery: 'personal',
      side: 'buyer',
    });
    expect(sendPortfolioInvite).not.toHaveBeenCalled();
    expect(inserts[0]).toMatchObject({
      table: 'contact_notes',
      row: {
        account_id: 'acc-1',
        contact_id: 'c-1',
        user_id: 'user-1',
        note_text: '🔑 Shared the buyer Portfolio invite via personal WhatsApp',
      },
    });
    expect(updates[0]).toMatchObject({ table: 'contacts' });
  });

  it('[CTM-011] notes nothing for a contact Portfolio would not link', async () => {
    queues['contacts'] = [
      { data: { ...ownerBuyer, classification: 'Others' } },
    ];

    const res = await POST(post({ channel: 'personal' }), { params });
    expect(res.status).toBe(409);
    expect(inserts).toHaveLength(0);
  });

  it('refuses a contact from another account', async () => {
    queues['contacts'] = [{ data: null }];
    const res = await POST(post({ channel: 'personal' }), { params });
    expect(res.status).toBe(404);
    expect(inserts).toHaveLength(0);
  });
});
