// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TeamAnalyticsContent from './team-analytics-content';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: 'acct-1',
    isOrgManager: true,
    isOrgLeader: false,
  }),
}));

vi.mock('@/hooks/usePlan', () => ({
  usePlan: () => ({
    isAllowed: () => true,
    isLoading: false,
    upgradeUrl: '/plans',
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({}),
}));

const analytics = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock('@/lib/team-analytics/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/team-analytics/queries')>()),
  loadTeamAnalytics: analytics.load,
}));

vi.mock('@/components/tremor/bar-chart', () => ({ BarChart: () => null }));

afterEach(() => {
  cleanup();
  analytics.load.mockReset();
});

function renderWithClient(ui: ReactElement) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>
  );
}

function memberRow(userId: string, name: string) {
  return {
    user_id: userId,
    full_name: name,
    org_role: 'org_manager',
    team_name: null,
    open_conversations: 0,
    conversations_closed: 0,
    messages_sent: 0,
    deals_won: 0,
    deals_won_value: 0,
    median_response_seconds: null,
    response_samples: 0,
  };
}

describe('Team analytics tab loading', () => {
  it('keeps the period selector visible and a skeleton only in the body while loading', () => {
    analytics.load.mockReturnValue(new Promise(() => undefined));
    renderWithClient(<TeamAnalyticsContent />);

    expect(screen.getByText(/Org-wide performance/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '30d' })).toBeTruthy();
    expect(
      screen.getByRole('status', { name: 'Loading team analytics' })
    ).toBeTruthy();
    expect(screen.queryByText('Messages Sent')).toBeNull();
  });

  it('shows an invite card above the tiles for a single-member account', async () => {
    analytics.load.mockResolvedValue([memberRow('u1', 'Asha')]);
    renderWithClient(<TeamAnalyticsContent />);

    expect(await screen.findByText('Only you so far')).toBeTruthy();
    expect(
      screen.getByText(
        'Invite your team to see per-member messages, response times and won value here.'
      )
    ).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Invite your team' })
        .getAttribute('href')
    ).toBe('/agents');
    expect(screen.getByText('Messages Sent')).toBeTruthy();
  });

  it('omits the invite card when there is more than one member', async () => {
    analytics.load.mockResolvedValue([
      memberRow('u1', 'Asha'),
      memberRow('u2', 'Ravi'),
    ]);
    renderWithClient(<TeamAnalyticsContent />);

    expect(await screen.findByText('Messages Sent')).toBeTruthy();
    expect(screen.queryByText('Only you so far')).toBeNull();
  });
});
