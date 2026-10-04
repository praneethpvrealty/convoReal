// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AutomationsPage from './page';

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: '',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.params),
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
}));

vi.mock('@/lib/navigation', () => ({
  pushUrl: (router: { push: (url: string) => void }, url: string) =>
    router.push(url),
}));

vi.mock('@/components/layout/favorite-button', () => ({
  FavoriteButton: () => null,
}));

vi.mock('./automations-list-content', () => ({
  default: () => <div>automations list</div>,
}));
vi.mock('../flows/flows-content', () => ({
  default: () => <div>flows list</div>,
}));
vi.mock('./analytics-content', () => ({
  default: () => <div>analytics view</div>,
}));

afterEach(() => {
  cleanup();
  nav.push.mockReset();
  nav.replace.mockReset();
  nav.params = '';
});

describe('AutomationsPage', () => {
  it('opens on the Automations list by default', () => {
    render(<AutomationsPage />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Automations',
      'Flows',
      'Analytics',
    ]);
    expect(
      screen
        .getByRole('tab', { name: 'Automations' })
        .getAttribute('aria-selected')
    ).toBe('true');
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getByText('automations list')).toBeTruthy();
    expect(screen.queryByText(/deal board/)).toBe(null);
  });

  it('keeps the flows tab addressable and moves with the arrow keys', () => {
    nav.params = 'tab=flows';
    render(<AutomationsPage />);
    expect(screen.getByText('flows list')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(nav.push).toHaveBeenCalledWith('/automations?tab=analytics');
  });

  it('still sends the old pipelines tab to Deals', () => {
    nav.params = 'tab=pipelines';
    render(<AutomationsPage />);
    expect(nav.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/deals/));
  });
});
