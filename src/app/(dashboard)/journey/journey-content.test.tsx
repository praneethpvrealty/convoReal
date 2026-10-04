// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { JourneyOverview } from '@/components/journey/journey-overview';
import JourneyPage from './journey-content';

const auth = vi.hoisted(() => ({
  current: { user: { id: 'user-1' }, accountId: 'acct-1' as string | null },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/deals',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => auth.current,
}));

vi.mock('@/hooks/use-can', () => ({
  useCan: () => true,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => new Promise(() => {}),
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/journey/capture', () => ({
  ensureJourneyStages: () => new Promise(() => {}),
}));

vi.mock('@/components/ui/convoreal-loader', () => ({
  ConvoRealLoader: () => <div data-testid="convoreal-loader" />,
}));

afterEach(() => {
  cleanup();
  auth.current = { user: { id: 'user-1' }, accountId: 'acct-1' };
});

describe('Journeys loading state', () => {
  it('holds the layout with a busy skeleton while stages load', () => {
    render(<JourneyPage embedded />);
    const status = screen.getByRole('status', { name: 'Loading journeys' });
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByTestId('convoreal-loader')).toBeNull();
  });

  it('shows the same skeleton while the journey list first loads', () => {
    auth.current = { user: { id: 'user-1' }, accountId: null };
    render(<JourneyOverview mode="buyer" stages={[]} currency="INR" canEdit />);
    const status = screen.getByRole('status', { name: 'Loading journeys' });
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByTestId('convoreal-loader')).toBeNull();
  });
});
