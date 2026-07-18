import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression coverage for the archived-account block in
 * getCurrentAccount() — the single chokepoint nearly every API route
 * funnels through. Without this, an archived (dormant/expired) account
 * keeps full API access even though the dashboard shows a read-only
 * overlay (see src/app/(dashboard)/dashboard-shell.tsx).
 */

const h = vi.hoisted(() => ({
  state: {
    user: { id: 'user-1' } as { id: string } | null,
    profile: null as Record<string, unknown> | null,
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: h.state.user },
            error: h.state.user ? null : new Error('no session'),
          }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.profile, error: null }),
          }),
        }),
      }),
    }),
}));

const activeProfile = {
  account_id: 'acc-1',
  account_role: 'owner',
  org_role: 'org_manager',
  team_id: null,
  account: { id: 'acc-1', name: 'Acme Realty', status: 'active' },
};

const archivedProfile = {
  ...activeProfile,
  account: { id: 'acc-1', name: 'Acme Realty', status: 'archived' },
};

let getCurrentAccount: typeof import('./account').getCurrentAccount;
let requireOrgRole: typeof import('./account').requireOrgRole;
let AccountArchivedError: typeof import('./account').AccountArchivedError;
let ForbiddenError: typeof import('./account').ForbiddenError;
let toErrorResponse: typeof import('./account').toErrorResponse;
let UnauthorizedError: typeof import('./account').UnauthorizedError;

beforeEach(async () => {
  h.state.user = { id: 'user-1' };
  h.state.profile = activeProfile;
  vi.resetModules();
  ({
    getCurrentAccount,
    requireOrgRole,
    AccountArchivedError,
    ForbiddenError,
    toErrorResponse,
    UnauthorizedError,
  } = await import('./account'));
});

describe('getCurrentAccount — archived account block', () => {
  it('resolves normally for an active account', async () => {
    const ctx = await getCurrentAccount();
    expect(ctx.accountId).toBe('acc-1');
    expect(ctx.account.name).toBe('Acme Realty');
  });

  it('throws AccountArchivedError for an archived account', async () => {
    h.state.profile = archivedProfile;
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(AccountArchivedError);
  });

  it('never returns a context for an archived account (no accidental fallthrough)', async () => {
    h.state.profile = archivedProfile;
    await expect(getCurrentAccount()).rejects.toThrow(
      /archived/i,
    );
  });

  it('still throws UnauthorizedError first when there is no session, before touching status', async () => {
    h.state.user = null;
    h.state.profile = archivedProfile;
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('requireOrgRole — org-hierarchy guard', () => {
  it('resolves for a caller at exactly the minimum role', async () => {
    const ctx = await requireOrgRole('org_manager');
    expect(ctx.orgRole).toBe('org_manager');
  });

  it('resolves for a caller above the minimum role', async () => {
    const ctx = await requireOrgRole('org_agent');
    expect(ctx.orgRole).toBe('org_manager');
  });

  it('throws ForbiddenError for a caller below the minimum role', async () => {
    h.state.profile = {
      ...activeProfile,
      account_role: 'agent',
      org_role: 'org_agent',
    };
    await expect(requireOrgRole('org_manager')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('names the Organization Manager in the org_manager rejection message', async () => {
    h.state.profile = {
      ...activeProfile,
      account_role: 'admin',
      org_role: 'org_leader',
    };
    await expect(requireOrgRole('org_manager')).rejects.toThrow(
      /Organization Manager/,
    );
  });

  it('throws UnauthorizedError before the role check when there is no session', async () => {
    h.state.user = null;
    await expect(requireOrgRole('org_manager')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

describe('toErrorResponse — AccountArchivedError mapping', () => {
  it('maps to a 403 with the archived-workspace message', async () => {
    const res = toErrorResponse(new AccountArchivedError());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/archived/i);
  });
});
