import { beforeEach, describe, expect, it, vi } from 'vitest';

// A generic service-role-client stand-in: SELECTs match fixture rows
// against ALL accumulated eq/is filters (so an account_id filter that
// excludes a foreign row genuinely returns null), and INSERTs are
// captured for assertions.
type Row = Record<string, unknown>;
let fixtures: Record<string, Row[]>;
let inserts: Record<string, Row[]>;

function makeAdmin() {
  return {
    from(table: string) {
      const filters: Row = {};
      let included: { column: string; values: unknown[] } | null = null;
      let mode: 'select' | 'insert' | 'update' = 'select';
      let insertRow: Row | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (payload: Row | Row[]) => {
          mode = 'insert';
          const rows = Array.isArray(payload) ? payload : [payload];
          (inserts[table] ||= []).push(...rows);
          insertRow = { id: `${table}-new`, ...rows[0] };
          return b;
        },
        upsert: (payload: Row[]) => {
          (inserts[table] ||= []).push(...payload);
          mode = 'insert';
          return b;
        },
        update: () => {
          mode = 'update';
          return b;
        },
        eq: (c: string, v: unknown) => {
          filters[c] = v;
          return b;
        },
        is: (c: string, v: unknown) => {
          filters[c] = v;
          return b;
        },
        in: (column: string, values: unknown[]) => {
          included = { column, values };
          return b;
        },
        maybeSingle: () => resolve(),
        single: () => resolve(),
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({
            data: mode === 'select' ? matchingRows() : insertRow,
            error: null,
          }).then(res),
      };
      function matchingRows() {
        return (fixtures[table] || []).filter(
          (r) =>
            Object.entries(filters).every(([k, v]) => r[k] === v) &&
            (!included || included.values.includes(r[included.column]))
        );
      }
      function resolve() {
        if (mode === 'insert')
          return Promise.resolve({ data: insertRow, error: null });
        const rows = fixtures[table] || [];
        const found =
          rows.find((r) =>
            Object.entries(filters).every(([k, v]) => r[k] === v)
          ) || null;
        return Promise.resolve({ data: found, error: null });
      }
      return b;
    },
  };
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => makeAdmin(),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock('@/lib/whatsapp/phone-utils', () => ({
  normalizePhoneWithCountryCode: () => '919900277111',
}));

const findOrCreateContact = vi.fn(async () => ({ contactId: 'contact-1' }));
vi.mock('@/lib/contacts/find-or-create', () => ({
  findOrCreateContact: (...args: unknown[]) =>
    findOrCreateContact(...(args as [])),
}));

const { POST } = await import('./route');

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/public/inquiry', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

const VICTIM = 'acc-victim';
const OWNER_USER = 'user-victim-owner';

beforeEach(() => {
  fixtures = {
    accounts: [{ id: VICTIM, owner_user_id: OWNER_USER }],
    properties: [
      // A property owned by ANOTHER tenant.
      {
        id: 'foreign-prop',
        account_id: 'acc-other',
        user_id: 'user-foreign-agent',
      },
      // A property in the victim account, managed by one of its agents.
      { id: 'own-prop', account_id: VICTIM, user_id: 'user-victim-agent' },
    ],
    profiles: [],
    contacts: [],
    conversations: [],
  };
  inserts = {};
});

describe('POST /api/public/inquiry — cross-tenant user_id scoping', () => {
  it("does NOT resolve a foreign property's agent; falls back to the account owner", async () => {
    const res = await post({
      accountId: VICTIM,
      phone: '9900277111',
      propertyId: 'foreign-prop',
    });
    expect(res.status).toBe(200);

    // The foreign property is filtered out by account_id, so the contact
    // and its notes are attributed to the victim account's own owner,
    // never the other tenant's user.
    const call = findOrCreateContact.mock.calls[0] as unknown as [
      unknown,
      { userId: string },
    ];
    expect(call[1].userId).toBe(OWNER_USER);
    expect(inserts.contact_notes?.[0].user_id).toBe(OWNER_USER);
    expect(inserts.contact_notes?.[0].user_id).not.toBe('user-foreign-agent');
  });

  it('resolves the managing agent for a property in the same account', async () => {
    await post({
      accountId: VICTIM,
      phone: '9900277111',
      propertyId: 'own-prop',
    });

    const call = findOrCreateContact.mock.calls[0] as unknown as [
      unknown,
      { userId: string },
    ];
    expect(call[1].userId).toBe('user-victim-agent');
    expect(inserts.todos?.[0].user_id).toBe('user-victim-agent');
  });

  it('requires accountId and phone', async () => {
    expect((await post({ phone: '9900277111' })).status).toBe(400);
    expect((await post({ accountId: VICTIM })).status).toBe(400);
  });
});

const IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
const batch = {
  accountId: VICTIM,
  name: 'Buyer',
  phone: '9900277111',
  propertyIds: IDS,
};
describe('showcase shortlist enquiries', () => {
  beforeEach(() => {
    fixtures.properties = IDS.map((id, i) => ({
      id,
      account_id: VICTIM,
      user_id: OWNER_USER,
      title: `Home ${i + 1}`,
      property_code: `HOME${i}`,
      status: 'Available',
      is_published: true,
    }));
  });
  it('links every selected property and creates one note, task and inbox message', async () => {
    expect(
      (await post({ ...batch, propertyIds: [...IDS, IDS[0]] })).status
    ).toBe(200);
    expect(
      inserts.contact_property_inquiries.map((r) => r.property_id)
    ).toEqual(IDS);
    for (const table of ['contact_notes', 'todos', 'messages'])
      expect(inserts[table]).toHaveLength(1);
    for (const id of IDS) {
      expect(inserts.contact_notes[0].note_text).toContain(id);
      expect(inserts.messages[0].content_text).toContain(id);
    }
  });
  it.each([
    { account_id: 'other' },
    { is_published: false },
    { status: 'Sold' },
  ])(
    'rejects the entire selection before writes when one property is inaccessible: %j',
    async (change) => {
      Object.assign(fixtures.properties[1], change);
      expect((await post(batch)).status).toBe(409);
      expect(inserts).toEqual({});
      expect(findOrCreateContact).not.toHaveBeenCalled();
    }
  );
  it.each(
    [[], ['bad'], Array(21).fill(IDS[0]), null].map((propertyIds) => ({
      propertyIds,
    }))
  )('rejects malformed or oversized selection %j', async ({ propertyIds }) => {
    expect((await post({ ...batch, propertyIds })).status).toBe(400);
    expect(inserts).toEqual({});
  });
  it('rejects a referral from another account', async () => {
    fixtures.contacts = [{ id: 'referrer', account_id: 'other' }];
    expect(
      (await post({ ...batch, referrerContactId: 'referrer' })).status
    ).toBe(400);
    expect(findOrCreateContact).not.toHaveBeenCalled();
  });
  it('routes a mixed-agent selection to the account owner', async () => {
    fixtures.properties[1].user_id = 'another-agent';
    await post(batch);
    expect(inserts.todos[0].user_id).toBe(OWNER_USER);
  });
});
