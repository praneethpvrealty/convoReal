// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import DashboardPage from './page';

const auth = vi.hoisted(() => ({
  current: {
    isOrgManager: false,
    isOrgLeader: false,
    canSendMessages: false,
    accountId: 'acct-1',
  },
}));

const feeds = vi.hoisted(() => ({
  gaps: [] as unknown[],
  radar: [] as unknown[],
}));

const nav = vi.hoisted(() => ({ push: vi.fn(), params: 'tab=overview' }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.params),
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => auth.current,
}));

vi.mock('@/lib/navigation', () => ({
  pushUrl: (router: { push: (url: string) => void }, url: string) =>
    router.push(url),
}));

vi.mock('@/components/layout/favorite-button', () => ({
  FavoriteButton: () => <button type="button">Favourite</button>,
}));

vi.mock('./dashboard-content', () => ({
  default: () => <div>overview content</div>,
}));
vi.mock('./focus-content', () => ({ default: () => null }));
vi.mock('../today/today-content', () => ({ default: () => null }));
vi.mock('../radar/radar-content', () => ({ default: () => null }));
vi.mock('../pulse/pulse-content', () => ({ default: () => null }));
vi.mock('../gaps/gaps-content', () => ({
  default: () => null,
  fetchGaps: async () => feeds.gaps,
}));
vi.mock('@/lib/radar/queries', () => ({
  loadMatchEvents: async () => feeds.radar,
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('../reengagement/reengagement-content', () => ({
  default: () => null,
}));
vi.mock('./team-analytics-content', () => ({ default: () => null }));
vi.mock('./market-content', () => ({ default: () => null }));

function render(ui: ReactElement) {
  return rtlRender(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  feeds.gaps = [];
  feeds.radar = [];
  auth.current = {
    isOrgManager: false,
    isOrgLeader: false,
    canSendMessages: false,
    accountId: 'acct-1',
  };
  nav.params = 'tab=overview';
});

describe('DashboardPage', () => {
  it('renders the compact title and tabs without the generic description', () => {
    render(<DashboardPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Dashboard' })
    ).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(7);
    expect(
      screen
        .getByRole('tab', { name: 'Overview' })
        .getAttribute('aria-selected')
    ).toBe('true');
    expect(
      screen.getByRole('tab', { name: 'Focus' }).getAttribute('aria-selected')
    ).toBe('false');
    expect(screen.queryByText(/Access your daily actions/)).toBeNull();
  });

  it('shows the Team tab only for managers and leaders', () => {
    const { unmount } = render(<DashboardPage />);
    expect(screen.queryByRole('tab', { name: 'Team' })).toBeNull();
    unmount();

    auth.current = { ...auth.current, isOrgManager: true };
    render(<DashboardPage />);
    expect(screen.getByRole('tab', { name: 'Team' })).toBeTruthy();
  });

  it('moves between tabs with the arrow keys', () => {
    render(<DashboardPage />);

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(nav.push).toHaveBeenCalledWith('/dashboard?tab=radar');

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(nav.push).toHaveBeenCalledWith('/dashboard?tab=focus');
  });

  it('shows a count pill on the Gaps and Match Radar tabs when there is work', async () => {
    feeds.gaps = [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }];
    feeds.radar = [{ id: 'e1' }];
    render(<DashboardPage />);

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Gaps 3' })).toBeTruthy()
    );
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Match Radar 1' })).toBeTruthy();
  });

  it('shows no pill when a count is zero', async () => {
    feeds.gaps = [];
    feeds.radar = [{ id: 'e1' }, { id: 'e2' }];
    render(<DashboardPage />);

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Match Radar 2' })).toBeTruthy()
    );
    expect(screen.getByRole('tab', { name: 'Gaps' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /^Gaps \d/ })).toBeNull();
  });
});
