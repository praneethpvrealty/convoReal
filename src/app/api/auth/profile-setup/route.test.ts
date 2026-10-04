import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  rpc: [] as Array<{ name: string; args: Record<string, unknown> }>,
  result: { data: 'acct-1', error: null } as {
    data: string | null;
    error: { code: string; message: string } | null;
  },
  tables: [] as string[],
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
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpc.push({ name, args });
      return state.result;
    },
    from: (table: string) => {
      state.tables.push(table);
      throw new Error('profile setup must not write tables directly');
    },
  }),
}));

import { POST } from './route';

function post(
  body: unknown = { fullName: ' Asha ', email: 'Asha@Example.com' }
) {
  return POST(
    new Request('http://test/api/auth/profile-setup', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

describe('[ACC-001] POST /api/auth/profile-setup', () => {
  beforeEach(() => {
    state.user = { id: 'user-1' };
    state.rpc = [];
    state.result = { data: 'acct-1', error: null };
    state.tables = [];
  });

  it('hands the whole bootstrap to one locked database function', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(state.rpc).toEqual([
      {
        name: 'bootstrap_staff_account',
        args: {
          p_user_id: 'user-1',
          p_full_name: 'Asha',
          p_email: 'asha@example.com',
        },
      },
    ]);
    expect(state.tables).toEqual([]);
  });

  it.each([
    [
      '42501',
      'Portfolio owner and buyer logins cannot create a brokerage account.',
    ],
    ['22023', 'ConvoReal is invite-only right now.'],
    ['22023', 'That invitation has already been claimed.'],
  ])(
    "answers 403 with the function's own words on code %s",
    async (code, message) => {
      state.result = { data: null, error: { code, message } };
      const res = await post();
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(message);
    }
  );

  it('reports any other database failure as 500', async () => {
    state.result = {
      data: null,
      error: { code: '23505', message: 'duplicate' },
    };
    expect((await post()).status).toBe(500);
  });

  it('refuses a signed-out caller before touching the database', async () => {
    state.user = null;
    expect((await post()).status).toBe(401);
    expect(state.rpc).toEqual([]);
  });

  it('refuses a body without a name or email before touching the database', async () => {
    expect((await post({ fullName: '', email: 'a@b.c' })).status).toBe(400);
    expect(state.rpc).toEqual([]);
  });
});
