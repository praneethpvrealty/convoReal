import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.caller ? { id: state.caller.userId } : null },
        error: null,
      }),
    },
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({
          data:
            table === 'flows'
              ? { id: 'flow-1' }
              : state.caller && {
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
      const builder = {
        update: (patch: Record<string, unknown>) => {
          state.updates.push(patch);
          return builder;
        },
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: { id: 'flow-1' }, error: null }),
      };
      return builder;
    },
  }),
}));

import { POST } from './route';

const activate = (status: string) =>
  POST(
    new Request('http://test/api/flows/flow-1/activate', {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ id: 'flow-1' }) }
  );

beforeEach(() => {
  state.caller = null;
  state.updates = [];
});

describe('POST /api/flows/[id]/activate', () => {
  it.each([
    ['a read-only agent', READ_ONLY_AGENT],
    ['a viewer', VIEWER],
  ])('refuses %s and changes nothing', async (_label, caller) => {
    state.caller = caller;
    const res = await activate('archived');
    expect(res.status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it('rejects a signed-out caller', async () => {
    const res = await activate('archived');
    expect(res.status).toBe(401);
    expect(state.updates).toEqual([]);
  });

  it('lets an agent archive a flow', async () => {
    state.caller = AGENT;
    const res = await activate('archived');
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([
      expect.objectContaining({ status: 'archived' }),
    ]);
  });
});
