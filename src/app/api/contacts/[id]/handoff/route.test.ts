import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  caller: null as { accountRole: string; isReadOnly: boolean } | null,
  rpc: [] as unknown[][],
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.caller ? { id: 'user-1' } : null },
        error: null,
      }),
    },
    rpc: async (...args: unknown[]) => {
      state.rpc.push(args);
      return { data: null, error: null };
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

import { POST } from './route';

const handoff = () =>
  POST(
    new NextRequest('http://test/api/contacts/contact-1/handoff', {
      method: 'POST',
      body: JSON.stringify({ newAgentId: 'user-2' }),
    }),
    { params: Promise.resolve({ id: 'contact-1' }) }
  );

beforeEach(() => {
  state.caller = null;
  state.rpc = [];
});

describe('[ACC-006] POST /api/contacts/[id]/handoff', () => {
  it.each([
    ['a read-only agent', { accountRole: 'agent', isReadOnly: true }],
    ['a viewer', { accountRole: 'viewer', isReadOnly: true }],
  ])('refuses %s and reassigns nothing', async (_label, caller) => {
    state.caller = caller;
    const res = await handoff();
    expect(res.status).toBe(403);
    expect(state.rpc).toEqual([]);
  });

  it('rejects a signed-out caller', async () => {
    const res = await handoff();
    expect(res.status).toBe(401);
    expect(state.rpc).toEqual([]);
  });

  it('hands the contact off for an agent', async () => {
    state.caller = { accountRole: 'agent', isReadOnly: false };
    const res = await handoff();
    expect(res.status).toBe(200);
    expect(state.rpc).toEqual([
      [
        'handoff_contact',
        { p_contact_id: 'contact-1', p_new_agent_id: 'user-2' },
      ],
    ]);
  });
});
