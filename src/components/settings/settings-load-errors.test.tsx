// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { MembersTab, REVOKE_INVITE_CONFIRM } from './members-tab';
import { RoutingRulesTab } from './routing-rules-tab';
import { TeamsTab } from './teams-tab';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1' },
    canManageMembers: true,
    isOrgManager: true,
    isOrgLeader: false,
    accountRole: 'owner',
    profileLoading: false,
  }),
}));

vi.mock('@/components/auth/require-role', () => ({
  RequireRole: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const RULE = {
  id: 'r1',
  rule_type: 'locality_match',
  match_value: 'Whitefield',
  target_team_id: null,
  target_agent_id: null,
  priority: 1,
  is_active: true,
};

const INVITE = {
  id: 'inv1',
  role: 'agent',
  label: 'Field team',
  created_at: '2026-11-01T00:00:00.000Z',
  expires_at: '2026-11-20T00:00:00.000Z',
};

type Route = (url: string, init?: RequestInit) => Response | undefined;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const fetchMock = vi.fn();
let route: Route = () => undefined;

beforeEach(() => {
  route = () => undefined;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const hit = route(url, init);
    if (hit) return hit;
    if (url.includes('/routing-rules')) return json({ rules: [RULE] });
    if (url.includes('/teams')) return json({ teams: [] });
    if (url.includes('/invitations')) return json({ invitations: [INVITE] });
    if (url.includes('/members')) return json({ members: [] });
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function deleteCalls(): string[] {
  return fetchMock.mock.calls
    .filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE'
    )
    .map(([url]) => url as string);
}

describe('[UIX-054] routing rules', () => {
  it('labels its icon-only delete and toggle controls', async () => {
    render(<RoutingRulesTab />);
    expect(
      await screen.findByRole('button', { name: 'Delete Locality match rule' })
    ).toBeTruthy();
    expect(
      screen.getByRole('switch', { name: 'Pause Locality match rule' })
    ).toBeTruthy();
  });

  it('asks before deleting a rule and keeps it when declined', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    render(<RoutingRulesTab />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete Locality match rule' })
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(deleteCalls()).toEqual([]);

    confirm.mockImplementation(() => true);
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Locality match rule' })
    );
    await waitFor(() =>
      expect(deleteCalls()).toEqual(['/api/account/routing-rules/r1'])
    );
  });

  it('shows a retryable error instead of No routing rules yet when the load fails', async () => {
    route = (url) =>
      url.includes('/routing-rules') ? json({ error: 'boom' }, 500) : undefined;
    render(<RoutingRulesTab />);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'routing rules'
    );
    expect(screen.queryByText('No routing rules yet.')).toBeNull();

    route = () => undefined;
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(
      await screen.findByRole('button', { name: 'Delete Locality match rule' })
    ).toBeTruthy();
  });
});

describe('[UIX-054] teams and members', () => {
  it('teams show a retryable error when the load fails', async () => {
    route = (url) =>
      url.includes('/teams') ? json({ error: 'boom' }, 500) : undefined;
    render(<TeamsTab />);
    expect((await screen.findByRole('alert')).textContent).toContain('teams');
  });

  it('members show a retryable error when the load fails', async () => {
    route = (url) =>
      url.includes('/members') ? json({ error: 'boom' }, 500) : undefined;
    render(<MembersTab />);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'account members'
    );
  });

  it('asks before revoking an invitation', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    render(<MembersTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Revoke/ }));
    expect(confirm).toHaveBeenCalledWith(REVOKE_INVITE_CONFIRM);
    expect(deleteCalls()).toEqual([]);

    confirm.mockImplementation(() => true);
    fireEvent.click(screen.getByRole('button', { name: /Revoke/ }));
    await waitFor(() =>
      expect(deleteCalls()).toEqual(['/api/account/invitations/inv1'])
    );
  });
});
