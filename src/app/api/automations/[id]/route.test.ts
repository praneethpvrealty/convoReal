import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

interface Caller {
  userId: string;
  accountId: string;
  accountRole: string;
  orgRole: string;
  isReadOnly: boolean;
}

const CREATOR: Caller = {
  userId: 'user-creator',
  accountId: 'acct-a',
  accountRole: 'agent',
  orgRole: 'org_agent',
  isReadOnly: false,
};
const TEAMMATE: Caller = { ...CREATOR, userId: 'user-teammate' };
const OUTSIDER: Caller = {
  ...CREATOR,
  userId: 'user-outsider',
  accountId: 'acct-b',
};
const VIEWER: Caller = {
  ...TEAMMATE,
  userId: 'user-viewer',
  accountRole: 'viewer',
  isReadOnly: true,
};
const READ_ONLY_AGENT: Caller = {
  ...TEAMMATE,
  userId: 'user-read-only',
  isReadOnly: true,
};

const state = vi.hoisted(() => ({
  caller: null as Caller | null,
  rows: [] as Row[],
  replaceSteps: [] as Array<{ id: string; steps: unknown }>,
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
        maybeSingle: async () => ({
          data: state.caller && {
            account_id: state.caller.accountId,
            account_role: state.caller.accountRole,
            org_role: state.caller.orgRole,
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
    from: (table: string) => {
      if (table !== 'automations') throw new Error(`unexpected ${table}`);
      const filters: Row = {};
      let op: 'select' | 'update' | 'delete' = 'select';
      let payload: Row = {};
      const run = () => {
        const hit = state.rows.filter((row) =>
          Object.entries(filters).every(([key, value]) => row[key] === value)
        );
        if (op === 'update') hit.forEach((row) => Object.assign(row, payload));
        if (op === 'delete')
          state.rows = state.rows.filter((row) => !hit.includes(row));
        return hit;
      };
      const builder = {
        select: () => builder,
        update: (next: Row) => {
          op = 'update';
          payload = next;
          return builder;
        },
        delete: () => {
          op = 'delete';
          return builder;
        },
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return builder;
        },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (resolve: (result: { data: Row[]; error: null }) => unknown) =>
          resolve({ data: run(), error: null }),
      };
      return builder;
    },
  }),
}));

vi.mock('@/lib/automations/steps-tree', () => ({
  loadStepsTree: async () => [
    {
      id: 'step-1',
      step_type: 'send_message',
      step_config: { text: 'Hello' },
      branches: {},
    },
  ],
  replaceSteps: async (id: string, steps: unknown) => {
    state.replaceSteps.push({ id, steps });
    return null;
  },
}));

import { DELETE, GET, PATCH } from './route';

const params = { params: Promise.resolve({ id: 'auto-1' }) };
const url = 'http://test/api/automations/auto-1';

function get() {
  return GET(new Request(url), params);
}

function patch(body: Row) {
  return PATCH(
    new Request(url, { method: 'PATCH', body: JSON.stringify(body) }),
    params
  );
}

function del() {
  return DELETE(new Request(url, { method: 'DELETE' }), params);
}

function automation() {
  return state.rows.find((row) => row.id === 'auto-1');
}

beforeEach(() => {
  state.caller = CREATOR;
  state.replaceSteps = [];
  state.rows = [
    {
      id: 'auto-1',
      user_id: CREATOR.userId,
      account_id: CREATOR.accountId,
      name: 'Welcome new leads',
      is_active: true,
      trigger_type: 'first_inbound_message',
      trigger_config: {},
    },
  ];
});

describe('/api/automations/[id] is scoped to the account, not the creator', () => {
  it('lets a teammate in the same account read an automation they did not create', async () => {
    state.caller = TEAMMATE;
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.automation).toMatchObject({
      id: 'auto-1',
      user_id: CREATOR.userId,
    });
    expect(body.steps).toHaveLength(1);
  });

  it('lets a teammate in the same account update and toggle it', async () => {
    state.caller = TEAMMATE;
    const res = await patch({
      is_active: false,
      name: 'Renamed by a teammate',
      steps: [],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(automation()).toMatchObject({
      is_active: false,
      name: 'Renamed by a teammate',
      user_id: CREATOR.userId,
    });
    expect(state.replaceSteps).toEqual([{ id: 'auto-1', steps: [] }]);
  });

  it('lets a teammate in the same account delete it', async () => {
    state.caller = TEAMMATE;
    const res = await del();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(automation()).toBeUndefined();
  });

  it('still serves the creator', async () => {
    expect((await get()).status).toBe(200);
    expect((await patch({ is_active: false })).status).toBe(200);
    expect((await del()).status).toBe(200);
  });

  it('answers 404 to a user in another account and leaves the row untouched', async () => {
    state.caller = OUTSIDER;
    const before = { ...automation() };

    for (const res of [
      await get(),
      await patch({ is_active: false, name: 'Hijacked', steps: [] }),
      await del(),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Not found' });
    }

    expect(automation()).toEqual(before);
    expect(state.replaceSteps).toEqual([]);
  });

  it('answers 404 for an automation that does not exist', async () => {
    state.rows = [];
    expect((await get()).status).toBe(404);
    expect((await patch({ is_active: false })).status).toBe(404);
    expect((await del()).status).toBe(404);
  });

  it('lets a viewer read but not change an automation', async () => {
    state.caller = VIEWER;
    const before = { ...automation() };
    expect((await get()).status).toBe(200);
    expect((await patch({ is_active: false })).status).toBe(403);
    expect((await del()).status).toBe(403);
    expect(automation()).toEqual(before);
  });

  it('[ACC-002] refuses a read-only member the changes an agent can make', async () => {
    state.caller = READ_ONLY_AGENT;
    const before = { ...automation() };
    expect((await get()).status).toBe(200);
    expect((await patch({ is_active: false })).status).toBe(403);
    expect((await del()).status).toBe(403);
    expect(automation()).toEqual(before);
    expect(state.replaceSteps).toEqual([]);
  });

  it('answers 401 to a signed-out caller', async () => {
    state.caller = null;
    expect((await get()).status).toBe(401);
    expect((await patch({ is_active: false })).status).toBe(401);
    expect((await del()).status).toBe(401);
    expect(automation()).toBeDefined();
  });
});

describe('PATCH /api/automations/[id] trigger availability', () => {
  beforeEach(() => {
    Object.assign(automation()!, {
      is_active: false,
      trigger_type: 'tag_added',
      trigger_config: { tag_id: 'tag-1' },
    });
  });

  it.each(['conversation_assigned', 'tag_added', 'time_based'])(
    'refuses to turn on an automation with the unavailable %s trigger',
    async (trigger) => {
      Object.assign(automation()!, { trigger_type: trigger });
      const before = { ...automation() };
      const res = await patch({ is_active: true });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.issues).toHaveLength(1);
      expect(body.issues[0].path).toBe('trigger.type');
      expect(body.issues[0].message).toContain(trigger);
      expect(body.data).toEqual({ issues: body.issues });
      expect(automation()).toEqual(before);
    }
  );

  it('still saves an unavailable-trigger automation while it stays paused', async () => {
    const res = await patch({ name: 'Renamed', is_active: false });
    expect(res.status).toBe(200);
    expect(automation()).toMatchObject({
      name: 'Renamed',
      is_active: false,
      trigger_type: 'tag_added',
    });
  });

  it('turns on an automation whose trigger is available', async () => {
    Object.assign(automation()!, {
      trigger_type: 'new_contact_created',
      trigger_config: {},
    });
    const res = await patch({ is_active: true });
    expect(res.status).toBe(200);
    expect(automation()).toMatchObject({ is_active: true });
  });

  it('lets a teammate turn on an available-trigger automation but not an unavailable one', async () => {
    state.caller = TEAMMATE;
    expect((await patch({ is_active: true })).status).toBe(400);
    Object.assign(automation()!, {
      trigger_type: 'new_contact_created',
      trigger_config: {},
    });
    expect((await patch({ is_active: true })).status).toBe(200);
    expect(automation()).toMatchObject({ is_active: true });
  });
});
