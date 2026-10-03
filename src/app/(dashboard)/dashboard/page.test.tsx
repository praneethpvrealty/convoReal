// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DashboardPage from './page';

const auth = vi.hoisted(() => ({
  current: {
    isOrgManager: false,
    isOrgLeader: false,
    canSendMessages: false,
    accountId: 'acct-1',
  },
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
vi.mock('../gaps/gaps-content', () => ({ default: () => null }));
vi.mock('../reengagement/reengagement-content', () => ({
  default: () => null,
}));
vi.mock('./team-analytics-content', () => ({ default: () => null }));
vi.mock('./market-content', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
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
});
