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
  runs: [] as Array<Record<string, unknown>>,
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

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: async (args: Record<string, unknown>) => {
    state.runs.push(args);
  },
}));

import { POST } from './route';

const trigger = () =>
  POST(
    new Request('http://test/api/automations/engine', {
      method: 'POST',
      body: JSON.stringify({ trigger_type: 'manual', contact_id: 'c-1' }),
    })
  );

beforeEach(() => {
  state.caller = null;
  state.runs = [];
});

describe('POST /api/automations/engine', () => {
  it.each([
    ['a read-only agent', READ_ONLY_AGENT],
    ['a viewer', VIEWER],
  ])('refuses %s and runs nothing', async (_label, caller) => {
    state.caller = caller;
    const res = await trigger();
    expect(res.status).toBe(403);
    expect(state.runs).toEqual([]);
  });

  it('rejects a signed-out caller', async () => {
    const res = await trigger();
    expect(res.status).toBe(401);
    expect(state.runs).toEqual([]);
  });

  it('lets an agent fire the account automations', async () => {
    state.caller = AGENT;
    const res = await trigger();
    expect(res.status).toBe(200);
    expect(state.runs).toEqual([
      expect.objectContaining({
        accountId: 'acct-a',
        triggerType: 'manual',
        contactId: 'c-1',
      }),
    ]);
  });
});
