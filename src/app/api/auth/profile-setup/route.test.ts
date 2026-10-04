import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: {
    id: 'user-1',
    user_metadata: {} as Record<string, unknown>,
    app_metadata: {} as Record<string, unknown>,
  },
  denRow: null as { id: string } | null,
  buyerRow: null as { id: string } | null,
  inserted: [] as string[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
      updateUser: async () => ({}),
    },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data:
              table === 'den_users'
                ? state.denRow
                : table === 'buyer_users'
                  ? state.buyerRow
                  : null,
            error: null,
          }),
        }),
      }),
      insert: () => {
        state.inserted.push(table);
        return {
          select: () => ({
            maybeSingle: async () => ({ data: { id: 'acct-1' }, error: null }),
          }),
        };
      },
      upsert: async () => {
        state.inserted.push(table);
        return { error: null };
      },
    }),
  }),
}));

import { POST } from './route';

function post() {
  return POST(
    new Request('http://test/api/auth/profile-setup', {
      method: 'POST',
      body: JSON.stringify({ fullName: 'Asha', email: 'asha@example.com' }),
    })
  );
}

describe('[ACC-001] POST /api/auth/profile-setup', () => {
  beforeEach(() => {
    state.user = { id: 'user-1', user_metadata: {}, app_metadata: {} };
    state.denRow = null;
    state.buyerRow = null;
    state.inserted = [];
  });

  it.each(['den', 'buyer'])(
    'refuses a login signed up with app_context %s',
    async (appContext) => {
      state.user.user_metadata = { app_context: appContext };
      const res = await post();
      expect(res.status).toBe(403);
      expect(state.inserted).toEqual([]);
    }
  );

  it('refuses a login that already has a den_users identity', async () => {
    state.denRow = { id: 'den-1' };
    const res = await post();
    expect(res.status).toBe(403);
    expect(state.inserted).toEqual([]);
  });

  it('refuses a login that already has a buyer_users identity', async () => {
    state.buyerRow = { id: 'buyer-1' };
    const res = await post();
    expect(res.status).toBe(403);
    expect(state.inserted).toEqual([]);
  });

  it('still bootstraps a staff login whose sign-up left no profile', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(state.inserted).toEqual(['accounts', 'profiles']);
  });
});
