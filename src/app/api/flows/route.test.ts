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
  inserted: { flows: [] as Row[], flow_nodes: [] as Row[] },
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
        order: () => Promise.resolve({ data: [{ id: 'flow-1' }], error: null }),
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
    from: (table: 'flows' | 'flow_nodes') => {
      let rows: Row[] = [];
      const builder = {
        insert: (next: Row | Row[]) => {
          rows = Array.isArray(next) ? next : [next];
          state.inserted[table].push(...rows);
          return table === 'flow_nodes'
            ? Promise.resolve({ error: null })
            : builder;
        },
        select: () => builder,
        single: async () => ({
          data: { id: 'flow-1', ...rows[0] },
          error: null,
        }),
      };
      return builder;
    },
  }),
}));

import { GET, POST } from './route';

const create = (body: Row) =>
  POST(
    new Request('http://test/api/flows', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  state.caller = null;
  state.inserted = { flows: [], flow_nodes: [] };
});

describe('POST /api/flows', () => {
  it.each([
    ['a read-only agent', READ_ONLY_AGENT],
    ['a viewer', VIEWER],
  ])('refuses %s and creates nothing', async (_label, caller) => {
    state.caller = caller;
    const res = await create({ name: 'Welcome' });
    expect(res.status).toBe(403);
    expect(state.inserted.flows).toEqual([]);
    expect(state.inserted.flow_nodes).toEqual([]);
  });

  it('refuses a read-only agent on the template clone path too', async () => {
    state.caller = READ_ONLY_AGENT;
    const res = await create({ template_slug: 'anything' });
    expect(res.status).toBe(403);
    expect(state.inserted.flows).toEqual([]);
  });

  it('rejects a signed-out caller', async () => {
    const res = await create({ name: 'Welcome' });
    expect(res.status).toBe(401);
    expect(state.inserted.flows).toEqual([]);
  });

  it('creates a draft flow for an agent', async () => {
    state.caller = AGENT;
    const res = await create({ name: ' Welcome ' });
    expect(res.status).toBe(201);
    expect(state.inserted.flows).toEqual([
      expect.objectContaining({
        account_id: 'acct-a',
        user_id: 'user-agent',
        name: 'Welcome',
        status: 'draft',
      }),
    ]);
  });
});

describe('GET /api/flows', () => {
  it('stays open to a read-only viewer', async () => {
    state.caller = VIEWER;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ flows: [{ id: 'flow-1' }] });
  });
});
