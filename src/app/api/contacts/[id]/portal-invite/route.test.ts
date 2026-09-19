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

const sendPortalInvite = vi.fn();

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

vi.mock('@/lib/contacts/portal-invite', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/contacts/portal-invite')>();
  return {
    ...actual,
    sendPortalInvite: (...args: unknown[]) => sendPortalInvite(...args),
  };
});

import { GET, POST } from './route';

const params = Promise.resolve({ id: 'c-1' });

function post(body: unknown) {
  return new Request('http://test/api/contacts/c-1/portal-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const contact = {
  id: 'c-1',
  name: 'Pramod Shivanna',
  phone: '+919480611236',
  areas_of_interest: ['BTM 2nd Stage'],
  property_interests: ['Vacant plot'],
  pref_listing_types: ['Sale'],
};

beforeEach(() => {
  queues = {};
  inserts = [];
  updates = [];
  sendPortalInvite.mockReset();
});

describe('GET /api/contacts/[id]/portal-invite', () => {
  it('[CTM-002] drafts the invite with a filtered, attributed portal link', async () => {
    queues['contacts'] = [{ data: contact }];
    queues['showcase_settings'] = [{ data: { subdomain: 'aryavarta' } }];
    queues['accounts'] = [{ data: { name: 'Aryavarta Realty' } }];
    queues['profiles'] = [{ data: { full_name: 'Praneeth' } }];

    const res = await GET(
      new Request('http://test/api/contacts/c-1/portal-invite') as never,
      { params }
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.phone).toBe('+919480611236');
    expect(data.url).toBe(
      'https://aryavarta.convoreal.com/?listing_type=Sale&category=Vacant+plot&search=BTM+2nd+Stage&v=c-1'
    );
    expect(data.message).toContain('Hi Pramod 👋');
    expect(data.message).toContain("I'm Praneeth from Aryavarta Realty.");
    expect(data.message).toContain(data.url);
    expect(data.message).toContain('vacant plot for sale in BTM 2nd Stage');
    expect(data.message).toContain('Shortlist the ones you like');
  });

  it('refuses a contact from another account', async () => {
    queues['contacts'] = [{ data: null }];
    const res = await GET(
      new Request('http://test/api/contacts/c-1/portal-invite') as never,
      { params }
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/contacts/[id]/portal-invite', () => {
  it('[CTM-002] sends from the business number by default', async () => {
    queues['contacts'] = [{ data: contact }];
    sendPortalInvite.mockResolvedValue({
      success: true,
      delivery: 'free_text',
      message: 'm',
      url: 'u',
    });

    const res = await POST(post({}) as never, { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data.delivery).toBe('free_text');
    expect(sendPortalInvite).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', userId: 'user-1' })
    );
    expect(inserts).toHaveLength(0);
  });

  it('[CTM-002] reports a closed window with no approved template as a conflict', async () => {
    queues['contacts'] = [{ data: contact }];
    sendPortalInvite.mockResolvedValue({
      success: false,
      message: 'm',
      url: 'u',
      error: 'window closed',
    });

    const res = await POST(post({ channel: 'business' }) as never, { params });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('window closed');
  });

  it('[CTM-002] records a personal WhatsApp share on the timeline instead of sending', async () => {
    queues['contacts'] = [{ data: contact }];
    queues['contact_notes'] = [{ data: null, error: null }];

    const res = await POST(post({ channel: 'personal' }) as never, { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data.delivery).toBe('personal');
    expect(sendPortalInvite).not.toHaveBeenCalled();
    expect(inserts[0]).toMatchObject({
      table: 'contact_notes',
      row: {
        account_id: 'acc-1',
        contact_id: 'c-1',
        user_id: 'user-1',
        note_text: '🔗 Shared the property portal link via personal WhatsApp',
      },
    });
    expect(updates[0]).toMatchObject({ table: 'contacts' });
    expect(
      (updates[0].row as { last_contacted_at?: string }).last_contacted_at
    ).toBeTruthy();
  });

  it('refuses a contact from another account', async () => {
    queues['contacts'] = [{ data: null }];
    const res = await POST(post({ channel: 'personal' }) as never, { params });
    expect(res.status).toBe(404);
    expect(inserts).toHaveLength(0);
  });
});
