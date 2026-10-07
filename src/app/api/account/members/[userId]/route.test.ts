import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  caller: null as {
    accountRole: string;
    orgRole: string;
    isReadOnly: boolean;
  } | null,
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
      return { data: 'acct-new', error: null };
    },
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({
          data: state.caller && {
            account_id: 'acct-a',
            account_role: state.caller.accountRole,
            org_role: state.caller.orgRole,
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

import { DELETE, PATCH } from './route';
import { PATCH as PATCH_ORG_ROLE } from './org-role/route';
import { PATCH as PATCH_TEAM } from './team/route';
import { POST as TRANSFER } from '../../transfer-ownership/route';

const target = '11111111-1111-4111-8111-111111111111';
const params = { params: Promise.resolve({ userId: target }) };
const json = (body: unknown) =>
  new NextRequest(`http://test/api/account/members/${target}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

const calls = {
  'change a role': () => PATCH(json({ role: 'agent' }), params),
  'remove a member': () =>
    DELETE(new NextRequest('http://test', { method: 'DELETE' }), params),
  'change an org role': () =>
    PATCH_ORG_ROLE(json({ role: 'org_leader' }), params),
  'move a member to a team': () => PATCH_TEAM(json({ teamId: null }), params),
  'transfer ownership': () =>
    TRANSFER(
      new NextRequest('http://test/api/account/transfer-ownership', {
        method: 'POST',
        body: JSON.stringify({ newOwnerUserId: target }),
      })
    ),
};

beforeEach(() => {
  state.caller = null;
  state.rpc = [];
});

describe('[ACC-007] member management routes', () => {
  it.each(Object.entries(calls))(
    'a read-only owner and manager cannot %s',
    async (_label, call) => {
      state.caller = {
        accountRole: 'owner',
        orgRole: 'org_manager',
        isReadOnly: true,
      };
      const res = await call();
      expect(res.status).toBe(403);
      expect(state.rpc).toEqual([]);
    }
  );

  it.each(Object.entries(calls))(
    'a writable owner and manager can still %s',
    async (_label, call) => {
      state.caller = {
        accountRole: 'owner',
        orgRole: 'org_manager',
        isReadOnly: false,
      };
      const res = await call();
      expect(res.status).toBe(200);
      expect(state.rpc).toHaveLength(1);
    }
  );
});
