import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySupabase } from '@/test/memory-supabase';

type Row = Record<string, unknown>;

let tables: Record<string, Row[]>;
let hidden: Row[];
let db: ReturnType<typeof memorySupabase>;

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    supabase: db,
    accountId: 'account-1',
    userId: 'user-1',
  }),
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () =>
    Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));

vi.mock('@/lib/billing/gates', () => ({
  checkPlanLimit: async () => ({ allowed: true }),
  gateResponse: () => Response.json({ error: 'gated' }, { status: 402 }),
}));

import { POST } from './route';

function create(body: Row) {
  return POST(
    new Request('http://localhost/api/contacts', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

describe('POST /api/contacts', () => {
  beforeEach(() => {
    tables = {
      contacts: [
        {
          id: 'abhishek',
          account_id: 'account-1',
          name: 'Abhishek',
          second_name: null,
          phone: '+919845919713',
          is_merged: false,
          created_at: '2026-10-16T10:47:56Z',
        },
        {
          id: 'merged-away',
          account_id: 'account-1',
          name: 'Old',
          second_name: null,
          phone: '+919880011375',
          is_merged: true,
          created_at: '2026-10-01T00:00:00Z',
        },
        {
          id: 'other-account',
          account_id: 'account-2',
          name: 'Elsewhere',
          second_name: null,
          phone: '+919742594250',
          is_merged: false,
          created_at: '2026-10-01T00:00:00Z',
        },
      ],
    };
    hidden = [
      {
        id: 'assigned-elsewhere',
        account_id: 'account-1',
        phone: '+91 97425-94251',
        is_merged: false,
      },
    ];
    const lastTen = (phone: unknown) =>
      String(phone ?? '')
        .replace(/\D/g, '')
        .slice(-10);
    const matching = (rows: Row[], args: Record<string, unknown>) =>
      rows.filter(
        (c) =>
          c.account_id === args.p_account_id &&
          !c.is_merged &&
          lastTen(c.phone) === args.p_key
      );
    db = memorySupabase(tables, {
      visible_contact_with_phone_key: (args) =>
        matching(tables.contacts, args)
          .slice(0, 1)
          .map((c) => ({ id: c.id, name: c.name, second_name: c.second_name })),
      account_has_phone_key: (args) =>
        matching([...tables.contacts, ...hidden], args).length > 0,
    });
  });

  it('[CTM-018] refuses a second contact on a number the account already has, in any spelling', async () => {
    for (const phone of ['+919845919713', '9845919713', '09845919713']) {
      const res = await create({ name: 'Abhishek', phone });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe('DUPLICATE_PHONE');
      expect(body.data).toEqual({ id: 'abhishek' });
      expect(body.error).toContain('Abhishek is already saved');
    }
    expect(tables.contacts).toHaveLength(3);
  });

  it('[CTM-018] matches a stored number written with spaces or dashes', async () => {
    tables.contacts[0].phone = '+91 98459-19713';
    const res = await create({ name: 'Abhishek', phone: '9845919713' });
    expect(res.status).toBe(409);
    expect((await res.json()).data).toEqual({ id: 'abhishek' });
  });

  it('[CTM-018] matches a number stored under any country or trunk prefix', async () => {
    tables.contacts[0].phone = '0091 98459 19713';
    const res = await create({ name: 'Abhishek', phone: '+919845919713' });
    expect(res.status).toBe(409);
  });

  it('[CTM-018] refuses a number held by a contact the caller cannot see, without revealing it', async () => {
    const res = await create({ name: 'Someone', phone: '9742594251' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('DUPLICATE_PHONE');
    expect(body.data).toBeUndefined();
    expect(body.error).toContain('Ask an admin');
    expect(tables.contacts).toHaveLength(3);
  });

  it('[CTM-018] creates the contact when only a merged-away record or another account holds the number', async () => {
    const merged = await create({ name: 'New', phone: '+919880011375' });
    expect(merged.status).toBeLessThan(300);
    const elsewhere = await create({ name: 'Mine', phone: '+919742594250' });
    expect(elsewhere.status).toBeLessThan(300);
    expect(
      tables.contacts.filter((c) => c.account_id === 'account-1')
    ).toHaveLength(4);
  });
});
