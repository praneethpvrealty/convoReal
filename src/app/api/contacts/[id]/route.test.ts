import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const writes = vi.hoisted(
  () =>
    [] as Array<{
      table: string;
      patch: Record<string, unknown> | null;
      filters: Array<[string, unknown]>;
    }>
);

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    userId: 'user-1',
    accountId: 'acc-1',
    supabase: {
      from: (table: string) => {
        const write = {
          table,
          patch: null as Record<string, unknown> | null,
          filters: [] as Array<[string, unknown]>,
        };
        writes.push(write);
        const chain = {
          update: (patch: Record<string, unknown>) => {
            write.patch = patch;
            return chain;
          },
          delete: () => chain,
          insert: () => Promise.resolve({ error: null }),
          eq: (column: string, value: unknown) => {
            write.filters.push([column, value]);
            return chain;
          },
          in: (column: string, value: unknown) => {
            write.filters.push([column, value]);
            return chain;
          },
          select: () =>
            Promise.resolve({
              data: [{ id: 'c1' }, { id: 'p1' }],
              error: null,
            }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
        };
        return chain;
      },
    },
  }),
  toErrorResponse: (err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => Response.json({}, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));

import { PUT } from './route';

function put(body: Record<string, unknown>) {
  return PUT(
    new NextRequest('http://localhost/api/contacts/c1', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'c1' }) }
  );
}

const propertyWrites = () => writes.filter((w) => w.table === 'properties');

describe('PUT /api/contacts/[id] property links', () => {
  beforeEach(() => {
    writes.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}')))
    );
  });

  it('[UIX-013] leaves property links alone when property_ids is omitted', async () => {
    const res = await put({ phone: '+919800000001', classification: 'Owner' });
    expect(res.status).toBe(200);
    expect(propertyWrites()).toEqual([]);
  });

  it('[UIX-013] relinks exactly the sent property_ids when present', async () => {
    const res = await put({
      phone: '+919800000001',
      classification: 'Owner',
      property_ids: ['p1'],
    });
    expect(res.status).toBe(200);
    expect(propertyWrites().map((w) => [w.patch, w.filters])).toEqual([
      [{ owner_contact_id: null }, [['owner_contact_id', 'c1']]],
      [{ owner_contact_id: 'c1' }, [['id', ['p1']]]],
    ]);
  });

  it('[UIX-013] refuses a minimum budget above the maximum', async () => {
    const res = await put({
      phone: '+919800000001',
      min_budget: 9000000,
      max_budget: 5000000,
    });
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
  });
});
