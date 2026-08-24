import { beforeEach, describe, expect, it, vi } from 'vitest';

const orFilters: string[] = [];

function propertiesQuery() {
  const result = { data: [], error: null, count: 0 };
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    range: () => query,
    or: (filter: string) => {
      orFilters.push(filter);
      return query;
    },
    then: <T>(onfulfilled: (value: typeof result) => T | PromiseLike<T>) =>
      Promise.resolve(result).then(onfulfilled),
  };
  return query;
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'account-1',
    role: 'owner',
    userId: 'user-1',
    supabase: { from: () => propertiesQuery() },
  }),
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/agents/source-inventory-sync', () => ({
  syncAgentSourceInventory: async () => ({ imported: 0, matched: 0 }),
}));

import { GET } from './route';

beforeEach(() => {
  orFilters.length = 0;
});

describe('GET /api/properties location filters', () => {
  it('combines selected localities into one OR filter', async () => {
    const response = await GET(
      new Request(
        'http://test/api/properties?location=Whitefield&location=Koramangala'
      )
    );

    expect(response.status).toBe(200);
    expect(orFilters).toHaveLength(1);
    expect(orFilters[0]).toContain('location.ilike."%whitefield%"');
    expect(orFilters[0]).toContain('location.ilike."%koramangala%"');
  });
});
