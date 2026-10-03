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
import type { MatchEvent } from '@/types';
import RadarContent from './radar-content';

const radar = vi.hoisted(() => ({
  loadMatchEvents: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: 'acct-1' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({}),
}));

vi.mock('@/lib/radar/queries', () => ({
  loadMatchEvents: radar.loadMatchEvents,
}));

vi.mock('@/components/radar/manual-contact-picker', () => ({
  ManualContactPicker: () => null,
}));

vi.mock('@/components/radar/direct-owner-card', () => ({
  DirectOwnerCard: () => null,
}));

function matchEvent(id: string, title: string): MatchEvent {
  return {
    id,
    account_id: 'acct-1',
    kind: 'new_property',
    property_id: `prop-${id}`,
    contact_id: null,
    matches: [
      {
        id: `contact-${id}`,
        name: 'Asha',
        detail: '+919800000000',
        score: 80,
        chips: [],
      },
    ],
    status: 'new',
    sent_count: 0,
    sent_at: null,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    property: { id: `prop-${id}`, title } as MatchEvent['property'],
    contact: null,
  };
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

function renderRadar(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <RadarContent />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  radar.loadMatchEvents.mockReset();
});

describe('Match Radar tab loading', () => {
  it('renders the heading at once and a skeleton only in the body while loading', async () => {
    const first = deferred<MatchEvent[]>();
    radar.loadMatchEvents.mockReturnValueOnce(first.promise);

    renderRadar(newClient());

    expect(
      screen.getByRole('heading', { level: 1, name: 'Match Radar' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Refresh Feed/ })).toBeTruthy();
    expect(
      screen.getByRole('status', { name: 'Loading Match Radar' })
    ).toBeTruthy();
    expect(screen.queryByText(/Scanning for matches/)).toBeNull();

    first.resolve([matchEvent('e1', 'Lake View Villa')]);

    expect(await screen.findByText('Lake View Villa')).toBeTruthy();
    expect(
      screen.queryByRole('status', { name: 'Loading Match Radar' })
    ).toBeNull();
    expect(screen.getByText('Send Match Alert (1)')).toBeTruthy();
  });

  it('renders from cache without refetching when the tab is reopened', async () => {
    radar.loadMatchEvents.mockResolvedValue([
      matchEvent('e1', 'Lake View Villa'),
    ]);
    const client = newClient();

    const first = renderRadar(client);
    await screen.findByText('Lake View Villa');
    first.unmount();

    renderRadar(client);

    expect(screen.getByText('Lake View Villa')).toBeTruthy();
    expect(
      screen.queryByRole('status', { name: 'Loading Match Radar' })
    ).toBeNull();
    expect(radar.loadMatchEvents).toHaveBeenCalledTimes(1);
  });

  it('keeps the cached cards on screen while Refresh Feed refetches', async () => {
    radar.loadMatchEvents.mockResolvedValueOnce([
      matchEvent('e1', 'Lake View Villa'),
    ]);
    renderRadar(newClient());
    await screen.findByText('Lake View Villa');

    const refetch = deferred<MatchEvent[]>();
    radar.loadMatchEvents.mockReturnValueOnce(refetch.promise);
    fireEvent.click(screen.getByRole('button', { name: /Refresh Feed/ }));

    await waitFor(() => expect(radar.loadMatchEvents).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Lake View Villa')).toBeTruthy();
    expect(
      screen.queryByRole('status', { name: 'Loading Match Radar' })
    ).toBeNull();

    refetch.resolve([matchEvent('e2', 'Hill Top Plot')]);

    expect(await screen.findByText('Hill Top Plot')).toBeTruthy();
    expect(screen.queryByText('Lake View Villa')).toBeNull();
  });
});
