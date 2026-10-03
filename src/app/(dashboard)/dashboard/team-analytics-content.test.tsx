// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

vi.mock('@/lib/team-analytics/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/team-analytics/queries')>()),
  loadTeamAnalytics: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('@/components/tremor/bar-chart', () => ({ BarChart: () => null }));

afterEach(cleanup);

describe('Team analytics tab loading', () => {
  it('keeps the period selector visible and a skeleton only in the body while loading', () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TeamAnalyticsContent />
      </QueryClientProvider>
    );

    expect(screen.getByText(/Org-wide performance/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '30d' })).toBeTruthy();
    expect(
      screen.getByRole('status', { name: 'Loading team analytics' })
    ).toBeTruthy();
    expect(screen.queryByText('Messages Sent')).toBeNull();
  });
});
