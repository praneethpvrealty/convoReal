// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HydratedShowcaseEvent, PulseStats } from '@/lib/pulse/queries';
import { PULSE_FEED_PAGE_SIZE } from '@/lib/pulse/feed-page';
import PulseContent from './pulse-content';

const pulse = vi.hoisted(() => ({
  loadPulseStats: vi.fn(),
  loadPulseFeed: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: 'acct-1' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({}),
}));

vi.mock('@/lib/pulse/queries', () => ({
  loadPulseStats: pulse.loadPulseStats,
  loadPulseFeed: pulse.loadPulseFeed,
  loadPulseViewedListings: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/components/pulse/property-viewers-dialog', () => ({
  PropertyViewersDialog: () => null,
}));

const stats: PulseStats = {
  totalViews: 42,
  uniqueSessions: 7,
  avgDwellTimeSec: 12,
};

function event(id: string, minute: number): HydratedShowcaseEvent {
  return {
    id,
    account_id: 'acct-1',
    session_key: `${id}-session`,
    event_type: 'open',
    property_id: null,
    contact_id: null,
    metadata: {},
    created_at: new Date(Date.UTC(2026, 9, 1, 0, minute)).toISOString(),
    contact: null,
  } as unknown as HydratedShowcaseEvent;
}

function fullPage(prefix: string): HydratedShowcaseEvent[] {
  return Array.from({ length: PULSE_FEED_PAGE_SIZE }, (_, i) =>
    event(`${prefix}${i}`, PULSE_FEED_PAGE_SIZE * 2 - i)
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPulse(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <PulseContent />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  pulse.loadPulseStats.mockReset();
  pulse.loadPulseFeed.mockReset();
});

describe('Showcase Pulse tab loading', () => {
  it('renders the heading at once and a skeleton only in the body while loading', async () => {
    const statsLoad = deferred<PulseStats>();
    pulse.loadPulseStats.mockReturnValueOnce(statsLoad.promise);
    pulse.loadPulseFeed.mockResolvedValueOnce([]);

    renderPulse(newClient());

    expect(
      screen.getByRole('heading', { level: 1, name: 'Showcase Pulse' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Refresh Stats/ })).toBeTruthy();
    expect(
      screen.getByRole('status', { name: 'Loading Showcase Pulse' })
    ).toBeTruthy();
    expect(screen.queryByText(/Reading the pulse/)).toBeNull();

    statsLoad.resolve(stats);

    expect(await screen.findByText('42')).toBeTruthy();
    expect(
      screen.queryByRole('status', { name: 'Loading Showcase Pulse' })
    ).toBeNull();
  });

  it('renders from cache without refetching when the tab is reopened', async () => {
    pulse.loadPulseStats.mockResolvedValue(stats);
    pulse.loadPulseFeed.mockResolvedValue([]);
    const client = newClient();

    const first = renderPulse(client);
    await screen.findByText('42');
    first.unmount();

    renderPulse(client);

    expect(screen.getByText('42')).toBeTruthy();
    expect(
      screen.queryByRole('status', { name: 'Loading Showcase Pulse' })
    ).toBeNull();
    expect(pulse.loadPulseStats).toHaveBeenCalledTimes(1);
    expect(pulse.loadPulseFeed).toHaveBeenCalledTimes(1);
  });

  it('[PLS-001] appends older pages to the cached first page and keeps them across a refresh', async () => {
    const firstPage = fullPage('a');
    pulse.loadPulseStats.mockResolvedValue(stats);
    pulse.loadPulseFeed.mockResolvedValueOnce(firstPage);
    renderPulse(newClient());

    const loadOlder = await screen.findByRole('button', {
      name: /Load older activity/,
    });
    pulse.loadPulseFeed.mockResolvedValueOnce([event('older-1', 0)]);
    fireEvent.click(loadOlder);

    expect(await screen.findByText(/older-1/)).toBeTruthy();
    expect(pulse.loadPulseFeed).toHaveBeenLastCalledWith(
      {},
      {
        createdAt: firstPage[firstPage.length - 1].created_at,
        id: firstPage[firstPage.length - 1].id,
      }
    );
    expect(
      screen.queryByRole('button', { name: /Load older activity/ })
    ).toBeNull();

    pulse.loadPulseFeed.mockResolvedValueOnce(firstPage);
    fireEvent.click(screen.getByRole('button', { name: /Refresh Stats/ }));
    await waitFor(() => expect(pulse.loadPulseFeed).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Refresh Stats/ })
      ).toHaveProperty('disabled', false)
    );
    expect(screen.getByText(/older-1/)).toBeTruthy();
  });
});
