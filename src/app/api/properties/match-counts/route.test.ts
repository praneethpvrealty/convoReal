import { beforeEach, describe, expect, it, vi } from 'vitest';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

const state = vi.hoisted(() => ({
  authError: null as Error | null,
  role: 'agent',
  properties: [] as Record<string, unknown>[],
  buyers: [] as Record<string, unknown>[],
  filters: [] as Array<[string, string, unknown]>,
  selects: [] as Array<[string, string]>,
  matches: vi.fn(),
}));

function table(name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {
    select: (columns: string) => {
      state.selects.push([name, columns]);
      return query;
    },
    eq: (column: string, value: unknown) => {
      state.filters.push([name, column, value]);
      return query;
    },
    in: (column: string, value: unknown) => {
      state.filters.push([name, column, value]);
      return query;
    },
    then: <T>(onfulfilled: (value: unknown) => T | PromiseLike<T>) =>
      Promise.resolve({
        data: name === 'properties' ? state.properties : state.buyers,
        error: null,
      }).then(onfulfilled),
  };
  return query;
}

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => {
    if (state.authError) throw state.authError;
    return {
      accountId: 'acct-1',
      userId: 'user-1',
      role: state.role,
      supabase: { from: table },
    };
  },
  toErrorResponse: () =>
    Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));

vi.mock('@/lib/contacts/inquired-intent', () => ({
  attachInquiredListingTypes: async (
    _db: unknown,
    _accountId: string,
    contacts: unknown[]
  ) => contacts,
}));

vi.mock('@/lib/matching', () => ({
  getMatchingContacts: state.matches,
}));

import { GET } from './route';
import { MATCH_BUYER_COLUMNS } from '@/lib/inventory/match-counts';

const request = (ids: string) =>
  new Request(`http://test/api/properties/match-counts?ids=${ids}`);

beforeEach(() => {
  state.authError = null;
  state.role = 'agent';
  state.properties = [];
  state.buyers = [];
  state.filters.length = 0;
  state.selects.length = 0;
  state.matches.mockReset();
});

describe('GET /api/properties/match-counts', () => {
  it('[PRP-068] counts matching buyers per listing on the server, inside the session account', async () => {
    state.properties = [
      { id: ID_A, user_id: 'user-1' },
      { id: ID_B, user_id: 'user-1' },
    ];
    state.buyers = [{ id: 'buyer-1' }, { id: 'buyer-2' }];
    state.matches.mockImplementation((property: { id: string }) =>
      property.id === ID_A ? [{}, {}] : []
    );

    const res = await GET(request(`${ID_A},${ID_B}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { [ID_A]: 2, [ID_B]: 0 } });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(state.filters).toContainEqual([
      'properties',
      'account_id',
      'acct-1',
    ]);
    expect(state.filters).toContainEqual(['properties', 'id', [ID_A, ID_B]]);
    expect(state.filters).toContainEqual(['contacts', 'account_id', 'acct-1']);
    expect(state.filters).toContainEqual([
      'contacts',
      'classification',
      'Buyer',
    ]);
    expect(state.selects).toContainEqual(['contacts', MATCH_BUYER_COLUMNS]);
  });

  it('[PRP-068] returns no counts, and no buyers, for an account without buyers', async () => {
    state.properties = [{ id: ID_A, user_id: 'user-1' }];

    const res = await GET(request(ID_A));

    expect(await res.json()).toEqual({ data: {} });
    expect(state.matches).not.toHaveBeenCalled();
  });

  it('[PRP-068] reads nothing when no ids are asked for', async () => {
    const res = await GET(request(''));

    expect(await res.json()).toEqual({ data: {} });
    expect(state.selects).toHaveLength(0);
  });

  it('[PRP-068] refuses malformed ids and more than 100 ids', async () => {
    expect((await GET(request('not-a-uuid'))).status).toBe(400);
    const many = Array.from(
      { length: 101 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    ).join(',');
    expect((await GET(request(many))).status).toBe(400);
    expect(state.selects).toHaveLength(0);
  });

  it('[PRP-068] refuses without a session', async () => {
    state.authError = new Error('no session');

    const res = await GET(request(ID_A));

    expect(res.status).toBe(401);
    expect(state.selects).toHaveLength(0);
  });
});
