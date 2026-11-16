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

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => db,
}));

import { POST } from './route';

function contact(id: string): Row {
  return {
    id,
    account_id: 'account-1',
    name: 'Abhishek',
    phone: '+919845919713',
    secondary_phones: [],
    is_merged: false,
    areas_of_interest: [],
    property_interests: [],
  };
}

describe('POST /api/contacts/merge', () => {
  beforeEach(() => {
    tables = {
      contacts: [contact('keep'), contact('dupe')],
      properties: [
        { id: 'hbr', account_id: 'account-1', owner_contact_id: 'keep' },
        { id: 'hsr', account_id: 'account-1', owner_contact_id: 'dupe' },
        { id: 'foreign', account_id: 'account-2', owner_contact_id: 'dupe' },
      ],
    };
    db = memorySupabase(tables, {
      merge_contact_conversations: () => null,
    });
  });

  it('[CTM-001] hands the duplicate’s listings to the surviving contact', async () => {
    const res = await POST(
      new Request('http://localhost/api/contacts/merge', {
        method: 'POST',
        body: JSON.stringify({ sourceId: 'dupe', targetId: 'keep' }),
      }) as never
    );
    expect(res.status).toBe(200);
    const owners = Object.fromEntries(
      tables.properties.map((p) => [p.id, p.owner_contact_id])
    );
    expect(owners).toEqual({ hbr: 'keep', hsr: 'keep', foreign: 'dupe' });
    expect(tables.contacts.find((c) => c.id === 'dupe')).toMatchObject({
      is_merged: true,
      merged_into_id: 'keep',
    });
  });
});
