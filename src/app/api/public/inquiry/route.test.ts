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
        in: () => b,
        maybeSingle: () => resolve(),
        single: () => resolve(),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: insertRow, error: null }).then(res),
      };
      function resolve() {
        if (mode === 'insert') return Promise.resolve({ data: insertRow, error: null });
        const rows = fixtures[table] || [];
        const found = rows.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v)) || null;
        return Promise.resolve({ data: found, error: null });
      }
      return b;
    },
  };
}

vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => makeAdmin() }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock('@/lib/whatsapp/phone-utils', () => ({
  normalizePhoneWithCountryCode: () => '919900277111',
}));

const findOrCreateContact = vi.fn(async () => ({ contactId: 'contact-1' }));
vi.mock('@/lib/contacts/find-or-create', () => ({
  findOrCreateContact: (...args: unknown[]) => findOrCreateContact(...(args as [])),
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
      { id: 'foreign-prop', account_id: 'acc-other', user_id: 'user-foreign-agent' },
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
  it('does NOT resolve a foreign property\'s agent; falls back to the account owner', async () => {
    const res = await post({ accountId: VICTIM, phone: '9900277111', propertyId: 'foreign-prop' });
    expect(res.status).toBe(200);

    // The foreign property is filtered out by account_id, so the contact
    // and its notes are attributed to the victim account's own owner,
    // never the other tenant's user.
    const call = findOrCreateContact.mock.calls[0] as unknown as [unknown, { userId: string }];
    expect(call[1].userId).toBe(OWNER_USER);
    expect(inserts.contact_notes?.[0].user_id).toBe(OWNER_USER);
    expect(inserts.contact_notes?.[0].user_id).not.toBe('user-foreign-agent');
  });

  it('resolves the managing agent for a property in the same account', async () => {
    await post({ accountId: VICTIM, phone: '9900277111', propertyId: 'own-prop' });

    const call = findOrCreateContact.mock.calls[0] as unknown as [unknown, { userId: string }];
    expect(call[1].userId).toBe('user-victim-agent');
    expect(inserts.todos?.[0].user_id).toBe('user-victim-agent');
  });

  it('requires accountId and phone', async () => {
    expect((await post({ phone: '9900277111' })).status).toBe(400);
    expect((await post({ accountId: VICTIM })).status).toBe(400);
  });
});
