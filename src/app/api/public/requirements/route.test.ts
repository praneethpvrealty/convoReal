import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same generic service-role stand-in as the inquiry test: SELECTs match
// fixtures against all eq filters (so an account_id filter excluding a
// foreign row returns null); INSERTs are captured.
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
vi.mock('@/app/api/leads/email-webhook/db-utils', () => ({
  assignTagsToContact: vi.fn(async () => undefined),
}));

const { POST } = await import('./route');

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/public/requirements', {
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
    contacts: [
      { id: 'foreign-contact', account_id: 'acc-other', email: 'agent@other.com' },
      { id: 'own-contact', account_id: VICTIM, email: 'agent@victim.com' },
    ],
    profiles: [{ email: 'agent@victim.com', user_id: 'user-victim-agent' }],
    conversations: [],
  };
  inserts = {};
});

describe('POST /api/public/requirements — cross-tenant user_id scoping', () => {
  it('ignores a foreign referrer contact; new contact is owned by the account owner', async () => {
    const res = await post({ accountId: VICTIM, phone: '9900277111', referrerContactId: 'foreign-contact' });
    expect(res.status).toBe(200);

    expect(inserts.contacts?.[0].user_id).toBe(OWNER_USER);
    expect(inserts.contacts?.[0].user_id).not.toBe('user-victim-agent');
    expect(inserts.contact_notes?.[0].user_id).toBe(OWNER_USER);
  });

  it('resolves the agent from a referrer contact in the same account', async () => {
    await post({ accountId: VICTIM, phone: '9900277111', referrerContactId: 'own-contact' });

    expect(inserts.contacts?.[0].user_id).toBe('user-victim-agent');
  });
});

describe('POST /api/public/requirements — budget magnitude inference', () => {
  it('expands small budget values by Crore/Lakh magnitude', async () => {
    // 2 -> 2 Cr (2e7), 5 -> 5 Cr (5e7); values are < 100 so treated as Crores.
    await post({ accountId: VICTIM, phone: '9900277111', minBudget: 2, maxBudget: 5 });
    expect(inserts.contacts?.[0].min_budget).toBe(20_000_000);
    expect(inserts.contacts?.[0].max_budget).toBe(50_000_000);
  });

  it('passes already-large budget values through unchanged', async () => {
    await post({ accountId: VICTIM, phone: '9900277111', minBudget: 5_000_000, maxBudget: 25_000_000 });
    expect(inserts.contacts?.[0].min_budget).toBe(5_000_000);
    expect(inserts.contacts?.[0].max_budget).toBe(25_000_000);
  });
});
