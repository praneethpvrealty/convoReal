import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

interface Caller {
  userId: string;
  accountId: string;
  accountRole: string;
  isReadOnly: boolean;
}

const AGENT: Caller = {
  userId: 'user-agent',
  accountId: 'acct-a',
  accountRole: 'agent',
  isReadOnly: false,
};
const READ_ONLY_AGENT: Caller = {
  ...AGENT,
  userId: 'user-read-only',
  isReadOnly: true,
};
const VIEWER: Caller = {
  ...AGENT,
  userId: 'user-viewer',
  accountRole: 'viewer',
  isReadOnly: true,
};

const state = vi.hoisted(() => ({
  caller: null as Caller | null,
  inserted: [] as Row[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.caller ? { id: state.caller.userId } : null },
        error: null,
      }),
    },
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => Promise.resolve({ data: [{ id: 'auto-1' }], error: null }),
        maybeSingle: async () => ({
          data: state.caller && {
            account_id: state.caller.accountId,
            account_role: state.caller.accountRole,
            org_role: 'org_agent',
            team_id: null,
            is_read_only: state.caller.isReadOnly,
            active_ui_language: 'en',
            account: {
              id: state.caller.accountId,
              name: 'Test account',
              status: 'active',
              default_language: 'en',
            },
          },
          error: null,
        }),
      };
      return builder;
    },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      let row: Row = {};
      const builder = {
        insert: (next: Row) => {
          row = next;
          state.inserted.push(next);
          return builder;
        },
        select: () => builder,
        single: async () => ({ data: { id: 'auto-1', ...row }, error: null }),
      };
      return builder;
    },
  }),
}));

import { GET, POST } from './route';

const create = () =>
  POST(
    new Request('http://test/api/automations', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Welcome',
        trigger_type: 'first_inbound_message',
      }),
    })
  );

beforeEach(() => {
  state.caller = null;
  state.inserted = [];
});

describe('[ACC-002] POST /api/automations', () => {
  it.each([
    ['a read-only agent', READ_ONLY_AGENT],
    ['a viewer', VIEWER],
  ])('refuses %s and creates nothing', async (_label, caller) => {
    state.caller = caller;
    const res = await create();
    expect(res.status).toBe(403);
    expect(state.inserted).toEqual([]);
  });

  it('rejects a signed-out caller', async () => {
    const res = await create();
    expect(res.status).toBe(401);
    expect(state.inserted).toEqual([]);
  });

  it('creates a paused automation for an agent', async () => {
    state.caller = AGENT;
    const res = await create();
    expect(res.status).toBe(201);
    expect(state.inserted).toEqual([
      expect.objectContaining({
        account_id: 'acct-a',
        user_id: 'user-agent',
        name: 'Welcome',
        is_active: false,
      }),
    ]);
  });
});

describe('GET /api/automations', () => {
  it('stays open to a read-only viewer', async () => {
    state.caller = VIEWER;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ automations: [{ id: 'auto-1' }] });
  });
});
