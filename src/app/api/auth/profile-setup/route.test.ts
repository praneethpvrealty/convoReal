import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: {
    id: 'user-1',
    user_metadata: {} as Record<string, unknown>,
    app_metadata: {} as Record<string, unknown>,
  },
  rows: {} as Record<string, unknown>,
  seatsTaken: 0,
  inserted: [] as string[],
  updated: [] as string[],
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
    rpc: async (name: string, args?: { p_token?: string }) =>
      name === 'hash_beta_token'
        ? { data: `hash:${args?.p_token}`, error: null }
        : { data: state.seatsTaken, error: null },
    from: (table: string) => {
      const chain = {
        eq: () => chain,
        maybeSingle: async () => ({
          data: state.rows[table] ?? null,
          error: null,
        }),
      };
      return {
        select: () => chain,
        insert: () => {
          state.inserted.push(table);
          return {
            select: () => ({
              maybeSingle: async () => ({
                data: { id: 'acct-1' },
                error: null,
              }),
            }),
          };
        },
        update: () => ({
          eq: async () => {
            state.updated.push(table);
            return { error: null };
          },
        }),
        upsert: async () => {
          state.inserted.push(table);
          return { error: null };
        },
      };
    },
  }),
}));

import { POST } from './route';

const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

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
    state.rows = {
      beta_program: { gate_enabled: true, account_cap: 100, default_quota: 5 },
    };
    state.seatsTaken = 3;
    state.inserted = [];
    state.updated = [];
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

  it.each(['den_users', 'buyer_users'])(
    'refuses a login that already has a %s identity',
    async (table) => {
      state.rows[table] = { id: 'persona-1' };
      state.user.user_metadata = { beta_invite: 'tok' };
      state.rows.beta_invites = {
        id: 'inv-1',
        status: 'pending',
        expires_at: future,
      };
      const res = await post();
      expect(res.status).toBe(403);
      expect(state.inserted).toEqual([]);
    }
  );

  it('refuses a profile-less login that holds no invitation while the gate is on', async () => {
    const res = await post();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/invite-only/);
    expect(state.inserted).toEqual([]);
  });

  it.each([
    ['accepted', 'claimed'],
    ['revoked', 'withdrawn'],
  ])('refuses a %s beta invitation', async (status, wording) => {
    state.user.user_metadata = { beta_invite: 'tok' };
    state.rows.beta_invites = { id: 'inv-1', status, expires_at: future };
    const res = await post();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(new RegExp(wording));
    expect(state.inserted).toEqual([]);
  });

  it('refuses an expired beta invitation and a full programme', async () => {
    state.user.user_metadata = { beta_invite: 'tok' };
    state.rows.beta_invites = {
      id: 'inv-1',
      status: 'pending',
      expires_at: past,
    };
    expect((await post()).status).toBe(403);
    state.rows.beta_invites = {
      id: 'inv-1',
      status: 'pending',
      expires_at: future,
    };
    state.seatsTaken = 100;
    expect((await post()).status).toBe(403);
    expect(state.inserted).toEqual([]);
  });

  it('bootstraps on a live beta invitation and claims the seat', async () => {
    state.user.user_metadata = { beta_invite: 'tok' };
    state.rows.beta_invites = {
      id: 'inv-1',
      status: 'pending',
      expires_at: future,
    };
    const res = await post();
    expect(res.status).toBe(200);
    expect(state.inserted).toEqual(['accounts', 'profiles']);
    expect(state.updated).toEqual(['beta_invites']);
  });

  it('bootstraps on a live team invitation without touching beta seats', async () => {
    state.user.user_metadata = { team_invite: 'team-tok' };
    state.rows.account_invitations = { accepted_at: null, expires_at: future };
    const res = await post();
    expect(res.status).toBe(200);
    expect(state.inserted).toEqual(['accounts', 'profiles']);
    expect(state.updated).toEqual([]);
  });

  it('bootstraps any staff login while the gate is off', async () => {
    state.rows.beta_program = {
      gate_enabled: false,
      account_cap: 100,
      default_quota: 5,
    };
    const res = await post();
    expect(res.status).toBe(200);
    expect(state.inserted).toEqual(['accounts', 'profiles']);
  });
});
