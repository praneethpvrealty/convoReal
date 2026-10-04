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
const OUTSIDER: Caller = { ...AGENT, userId: 'user-out', accountId: 'acct-b' };

const state = vi.hoisted(() => ({
  caller: null as Caller | null,
  automations: [] as Row[],
  steps: [] as Row[],
  inserted: { automations: [] as Row[], steps: [] as Row[] },
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
    from: (table: string) => {
      const filters: Row = {};
      let insertRows: Row[] | null = null;
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return builder;
        },
        order: () => builder,
        insert: (rows: Row | Row[]) => {
          insertRows = Array.isArray(rows) ? rows : [rows];
          if (table === 'automation_steps') {
            state.inserted.steps.push(...insertRows);
            return Promise.resolve({ error: null });
          }
          return builder;
        },
        maybeSingle: async () => ({
          data:
            state.automations.find((row) =>
              Object.entries(filters).every(
                ([key, value]) => row[key] === value
              )
            ) ?? null,
          error: null,
        }),
        single: async () => {
          const row = { id: 'copy-1', ...insertRows![0] };
          state.inserted.automations.push(row);
          return { data: row, error: null };
        },
        then: (resolve: (value: unknown) => unknown) =>
          resolve({
            data: state.steps.filter((row) =>
              Object.entries(filters).every(
                ([key, value]) => row[key] === value
              )
            ),
            error: null,
          }),
      };
      return builder;
    },
  }),
}));

import { POST } from './route';

const duplicate = () =>
  POST(new Request('http://test/api/automations/auto-1/duplicate'), {
    params: Promise.resolve({ id: 'auto-1' }),
  });

beforeEach(() => {
  state.caller = null;
  state.inserted = { automations: [], steps: [] };
  state.automations = [
    {
      id: 'auto-1',
      account_id: 'acct-a',
      user_id: 'user-creator',
      name: 'Welcome',
      description: null,
      trigger_type: 'keyword_match',
      trigger_config: { keywords: ['hi'] },
      is_active: true,
    },
  ];
  state.steps = [
    {
      id: 's1',
      automation_id: 'auto-1',
      parent_step_id: null,
      branch: null,
      step_type: 'send_message',
      step_config: { text: 'Hello' },
      position: 0,
    },
    {
      id: 's2',
      automation_id: 'auto-1',
      parent_step_id: 's1',
      branch: 'yes',
      step_type: 'add_tag',
      step_config: {},
      position: 1,
    },
  ];
});

describe('[ACC-002] POST /api/automations/[id]/duplicate', () => {
  it.each([
    ['a read-only agent', READ_ONLY_AGENT],
    ['a viewer', VIEWER],
  ])('refuses %s and copies nothing', async (_label, caller) => {
    state.caller = caller;
    const res = await duplicate();
    expect(res.status).toBe(403);
    expect(state.inserted.automations).toEqual([]);
    expect(state.inserted.steps).toEqual([]);
  });

  it('copies a teammate automation for an agent, paused, with its steps re-parented', async () => {
    state.caller = AGENT;
    const res = await duplicate();
    expect(res.status).toBe(201);
    expect(state.inserted.automations).toEqual([
      expect.objectContaining({
        user_id: 'user-agent',
        account_id: 'acct-a',
        name: 'Welcome (Copy)',
        is_active: false,
      }),
    ]);
    const [first, second] = state.inserted.steps;
    expect(first).toMatchObject({
      automation_id: 'copy-1',
      parent_step_id: null,
    });
    expect(second).toMatchObject({
      automation_id: 'copy-1',
      parent_step_id: first.id,
      branch: 'yes',
    });
    expect(first.id).not.toBe('s1');
  });

  it('answers 404 for an automation in another account', async () => {
    state.caller = OUTSIDER;
    const res = await duplicate();
    expect(res.status).toBe(404);
    expect(state.inserted.automations).toEqual([]);
  });
});
