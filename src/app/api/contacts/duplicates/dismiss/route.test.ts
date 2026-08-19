import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueryResult = { data?: unknown; error?: unknown };

const UUID_A = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '123e4567-e89b-12d3-a456-426614174001';

let upsertCalls: Array<{ rows: unknown; options?: { onConflict?: string } }>;
let deleteCalls: Array<{ table: string; eq: Record<string, unknown> }>;
let queues: {
  contactsSelect: QueryResult[];
  duplicateDismissalsUpsert: QueryResult[];
  duplicateDismissalsDelete: QueryResult[];
};

function pop(bucket: QueryResult[]): QueryResult {
  return bucket.shift() ?? { data: null, error: null };
}

function makeDb() {
  return {
    from(table: string) {
      const eqFilters: Record<string, unknown> = {};
      let action: 'select' | 'upsert' | 'delete' = 'select';

      const builder = {
        select: () => {
          action = 'select';
          return builder;
        },
        eq: (column: string, value: unknown) => {
          eqFilters[column] = value;
          return builder;
        },
        in: () => builder,
        upsert: (rows: unknown, options: { onConflict?: string }) => {
          action = 'upsert';
          upsertCalls.push({ rows, options });
          return Promise.resolve(pop(queues.duplicateDismissalsUpsert));
        },
        delete: () => {
          action = 'delete';
          return builder;
        },
        then: (resolve: (value: unknown) => void, reject?: (value: unknown) => void) => {
          if (action === 'select') {
            return Promise.resolve(pop(queues.contactsSelect)).then(resolve, reject);
          }
          if (action === 'delete') {
            deleteCalls.push({ table, eq: { ...eqFilters } });
            return Promise.resolve(pop(queues.duplicateDismissalsDelete)).then(
              resolve,
              reject,
            );
          }
          return Promise.resolve(pop(queues.duplicateDismissalsUpsert)).then(
            resolve,
            reject,
          );
        },
      } as const;

      return builder;
    },
  };
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    supabase: makeDb(),
    accountId: '11111111-1111-1111-1111-111111111111',
    userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  }),
  toErrorResponse: (err: unknown) =>
    Response.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 }),
}));

import { DELETE, POST } from './route';

function request(body: { contactIds: unknown[] }, method: 'POST' | 'DELETE' = 'POST') {
  return new Request('http://localhost/api/contacts/duplicates/dismiss', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  upsertCalls = [];
  deleteCalls = [];
  queues = {
    contactsSelect: [{ data: [] }],
    duplicateDismissalsUpsert: [{ error: null }],
    duplicateDismissalsDelete: [{ error: null }],
  };
});

describe('POST /api/contacts/duplicates/dismiss', () => {
  it('stores one dismissal row per pair', async () => {
    queues.contactsSelect = [
      {
        data: [{ id: UUID_A }, { id: UUID_B }],
      },
    ];
    const res = await POST(
      request({ contactIds: [UUID_B, UUID_A] }) as never
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { dismissed: 1 },
    });
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toMatchObject({
      options: { onConflict: 'account_id,contact_a_id,contact_b_id' },
      rows: [
        {
          contact_a_id: UUID_A,
          contact_b_id: UUID_B,
        },
      ],
    });
  });

  it('rejects malformed contact ids before hitting persistence', async () => {
    const res = await POST(
      request({ contactIds: ['not-a-uuid', UUID_B] }) as never
    );
    expect(res.status).toBe(400);
    expect(upsertCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  it('returns 404 when any contact is outside the caller account', async () => {
    queues.contactsSelect = [{ data: [{ id: UUID_A }] }];
    const res = await POST(
      request({ contactIds: [UUID_A, UUID_B] }) as never
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Contact not found');
  });
});

describe('DELETE /api/contacts/duplicates/dismiss', () => {
  it('removes one dismissal row per pair', async () => {
    queues.contactsSelect = [
      { data: [{ id: UUID_A }, { id: UUID_B }] },
    ];
    queues.duplicateDismissalsDelete = [{ error: null }];
    const res = await DELETE(
      request({ contactIds: [UUID_B, UUID_A], }, 'DELETE') as never
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { restored: true } });
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].table).toBe('contact_duplicate_dismissals');
  });
});
