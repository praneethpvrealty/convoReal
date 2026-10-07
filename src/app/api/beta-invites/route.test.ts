import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  caller: null as { accountRole: string; isReadOnly: boolean } | null,
  rpc: [] as string[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.caller ? { id: 'user-1' } : null },
        error: null,
      }),
    },
    rpc: async (name: string) => {
      state.rpc.push(name);
      return name === 'issue_beta_invite'
        ? {
            data: {
              id: 'invite-1',
              expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
              used: 1,
              quota: 5,
            },
            error: null,
          }
        : { data: null, error: null };
    },
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({
          data: state.caller && {
            account_id: 'acct-a',
            account_role: state.caller.accountRole,
            org_role: 'org_agent',
            team_id: null,
            is_read_only: state.caller.isReadOnly,
            active_ui_language: 'en',
            full_name: 'Asha',
            account: {
              id: 'acct-a',
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

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

vi.mock('@/lib/agents/source-inventory-preview', () => ({
  safeSourceInventoryPreview: async () => null,
}));

import { POST } from './route';

const issue = () =>
  POST(
    new Request('http://test/api/beta-invites', {
      method: 'POST',
      body: JSON.stringify({ label: 'Ravi' }),
    })
  );

beforeEach(() => {
  state.caller = null;
  state.rpc = [];
});

describe('[ACC-006] POST /api/beta-invites', () => {
  it.each([
    ['a read-only agent', { accountRole: 'agent', isReadOnly: true }],
    ['a viewer', { accountRole: 'viewer', isReadOnly: true }],
  ])('refuses %s and spends no seat', async (_label, caller) => {
    state.caller = caller;
    const res = await issue();
    expect(res.status).toBe(403);
    expect(state.rpc).toEqual([]);
  });

  it('rejects a signed-out caller', async () => {
    const res = await issue();
    expect(res.status).toBe(401);
    expect(state.rpc).toEqual([]);
  });

  it('issues a seat for an agent', async () => {
    state.caller = { accountRole: 'agent', isReadOnly: false };
    const res = await issue();
    expect(res.status).toBe(200);
    expect(state.rpc).toContain('issue_beta_invite');
    expect((await res.json()).id).toBe('invite-1');
  });
});
