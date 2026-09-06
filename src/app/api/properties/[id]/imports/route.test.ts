import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  authError: null as Error | null,
  source: {
    data: { id: '11111111-1111-1111-1111-111111111111' } as {
      id: string;
    } | null,
    error: null as Error | null,
  },
  copies: {
    data: [] as Record<string, unknown>[],
    error: null as Error | null,
  },
  profiles: {
    data: [] as Record<string, unknown>[],
    error: null as Error | null,
  },
  calls: [] as Array<[string, string, ...unknown[]]>,
  admin: vi.fn(),
}));

function query(scope: string, result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'neq',
    'in',
    'order',
    'range',
    'maybeSingle',
  ]) {
    chain[method] = (...args: unknown[]) => {
      state.calls.push([scope, method, ...args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return chain;
}

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => {
    if (state.authError) throw state.authError;
    return {
      accountId: 'source-account',
      supabase: { from: () => query('source', state.source) },
    };
  },
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: 'Request failed' },
      { status: error === state.authError ? 401 : 500 }
    ),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: state.admin }));

import { GET } from './route';

const propertyId = '11111111-1111-1111-1111-111111111111';
const request = (page = '1', id = propertyId) =>
  GET(new Request(`https://test/api/properties/${id}/imports?page=${page}`), {
    params: Promise.resolve({ id }),
  });
const copy = (index = 0) => ({
  id: `copy-${index}`,
  account_id: `recipient-${index}`,
  user_id: `agent-${index}`,
  created_at: '2026-09-06T05:00:00Z',
  status: 'Available',
  recipient: { name: `Agency ${index}`, status: 'active' },
});

beforeEach(() => {
  state.authError = null;
  state.source = { data: { id: propertyId }, error: null };
  state.copies = { data: [], error: null };
  state.profiles = { data: [], error: null };
  state.calls = [];
  state.admin.mockReset().mockReturnValue({
    from: (table: string) =>
      query(table, table === 'properties' ? state.copies : state.profiles),
  });
});

describe('property import visibility', () => {
  it('rejects signed-out users before any cross-account lookup', async () => {
    state.authError = new Error('Unauthorized');
    expect((await request()).status).toBe(401);
    expect(state.admin).not.toHaveBeenCalled();
  });
  it('hides another account’s property and does not query its recipients', async () => {
    state.source.data = null;
    expect((await request()).status).toBe(404);
    expect(state.calls).toContainEqual([
      'source',
      'eq',
      'account_id',
      'source-account',
    ]);
    expect(state.calls).toContainEqual(['source', 'eq', 'id', propertyId]);
    expect(state.admin).not.toHaveBeenCalled();
  });
  it('does not bypass a failed source lookup', async () => {
    state.source.error = new Error('Database unavailable');
    expect((await request()).status).toBe(500);
    expect(state.admin).not.toHaveBeenCalled();
  });
  it.each(['0', '-1', '1.5', 'NaN', '10001'])(
    'rejects invalid page %s',
    async (page) => {
      expect((await request(page)).status).toBe(400);
      expect(state.admin).not.toHaveBeenCalled();
    }
  );
  it('rejects an invalid property ID', async () => {
    expect((await request('1', 'invalid')).status).toBe(400);
    expect(state.admin).not.toHaveBeenCalled();
  });
  it('returns minimal agent identity only for direct cross-account copies', async () => {
    state.copies.data = [copy(), { ...copy(1), status: 'Pending Review' }];
    state.profiles.data = [
      {
        user_id: 'agent-0',
        account_id: 'unrelated-account',
        full_name: 'Wrong profile',
      },
      {
        user_id: 'agent-0',
        account_id: 'recipient-0',
        full_name: 'Agent Zero',
        phone: 'private',
      },
    ];
    const response = await request();
    const body = await response.json();
    expect(body.data[0]).toEqual({
      id: 'copy-0',
      agencyName: 'Agency 0',
      agentName: 'Agent Zero',
      recordedAt: '2026-09-06T05:00:00Z',
      status: 'In inventory',
    });
    expect(body.data[1].status).toBe('Pending review');
    expect(body.data[1].agentName).toBeNull();
    expect(JSON.stringify(body)).not.toContain('private');
    expect(state.calls).toContainEqual([
      'properties',
      'eq',
      'source_property_id',
      propertyId,
    ]);
    expect(state.calls).toContainEqual([
      'properties',
      'neq',
      'account_id',
      'source-account',
    ]);
    expect(state.calls).toContainEqual([
      'profiles',
      'in',
      'account_id',
      ['recipient-0', 'recipient-1'],
    ]);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('paginates and bounds profile lookups to the displayed rows', async () => {
    state.copies.data = Array.from({ length: 21 }, (_, index) => copy(index));
    const body = await (await request('2')).json();
    expect(body.data).toHaveLength(20);
    expect(body.nextPage).toBe(3);
    expect(state.calls).toContainEqual(['properties', 'range', 20, 40]);
    expect(
      state.calls.find(
        ([scope, method, field]) =>
          scope === 'profiles' && method === 'in' && field === 'user_id'
      )?.[3]
    ).toHaveLength(20);
  });
  it('returns an empty list without querying profiles', async () => {
    expect(await (await request()).json()).toEqual({
      data: [],
      nextPage: null,
    });
    expect(state.calls.some(([scope]) => scope === 'profiles')).toBe(false);
  });
  it('reports a recipient lookup failure instead of a false empty state', async () => {
    state.copies.error = new Error('Unavailable');
    expect((await request()).status).toBe(500);
  });
});
