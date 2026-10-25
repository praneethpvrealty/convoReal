import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  result: { data: null, error: null } as {
    data: Record<string, unknown> | null;
    error: { code: string; message: string } | null;
  },
  filters: [] as Array<[string, unknown]>,
  tables: [] as string[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    from: (table: string) => {
      state.tables.push(table);
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          state.filters.push([column, value]);
          return query;
        },
        maybeSingle: async () => state.result,
      };
      return query;
    },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    throw new Error('the session profile route must not bypass RLS');
  },
}));

import { GET } from './route';

describe('[ACC-008] GET /api/auth/profile', () => {
  beforeEach(() => {
    state.user = { id: 'user-1' };
    state.result = { data: null, error: null };
    state.filters = [];
    state.tables = [];
  });

  it('refuses a caller without a session', async () => {
    state.user = null;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(state.tables).toEqual([]);
  });

  it("reads only the caller's own row through their session client", async () => {
    state.result = {
      data: {
        id: 'p-1',
        full_name: 'Asha',
        email: 'asha@example.com',
        avatar_url: null,
        role: null,
        account_id: 'acct-1',
        account_role: 'owner',
        org_role: 'org_manager',
        account: { id: 'acct-1', name: 'Asha Realty', status: 'archived' },
      },
      error: null,
    };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(state.tables).toEqual(['profiles']);
    expect(state.filters).toEqual([['user_id', 'user-1']]);
    const body = await res.json();
    expect(body.data.profile.account_id).toBe('acct-1');
    expect(body.data.profile.org_role).toBe('org_manager');
    expect(body.data.account.status).toBe('archived');
  });

  it('answers data: null when the caller has no profile yet', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
  });

  it('reports a failed read as an error, never as "no profile"', async () => {
    state.result = {
      data: null,
      error: { code: '57014', message: 'statement timeout' },
    };
    const res = await GET();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Could not load profile' });
  });
});
