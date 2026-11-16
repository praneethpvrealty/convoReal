import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySupabase } from '@/test/memory-supabase';

type Row = Record<string, unknown>;

let tables: Record<string, Row[]>;
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
    db = memorySupabase(tables);
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
