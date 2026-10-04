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

vi.mock('@/hooks/useAuth', () => ({
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

function scoredEvent(id: string, scores: number[]): MatchEvent {
  return {
    ...matchEvent(id, 'Old House on 60x90 Plot'),
    matches: scores.map((score, index) => ({
      id: `contact-${index}`,
      name: `Buyer ${index}`,
      detail: null,
      score,
      chips: [],
    })),
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

describe('Match Radar target selection', () => {
  it('pre-checks only 80%+ targets and toggles between 80%+ and all', async () => {
    radar.loadMatchEvents.mockResolvedValue([scoredEvent('e1', [100, 80, 65])]);
    renderRadar(newClient());

    expect(await screen.findByText('Send Match Alert (2)')).toBeTruthy();
    expect(
      screen
        .getAllByRole('checkbox')
        .map((row) => row.getAttribute('aria-checked'))
    ).toEqual(['true', 'true', 'false']);

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('Send Match Alert (3)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Select 80%+' }));
    expect(screen.getByText('Send Match Alert (2)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Deselect All' }));
    expect(screen.getByText('Send Match Alert (0)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select All' })).toBeTruthy();
  });

  it('hides the 80%+ toggle when every target is already 80%+', async () => {
    radar.loadMatchEvents.mockResolvedValue([scoredEvent('e1', [95, 85])]);
    renderRadar(newClient());

    expect(await screen.findByText('Send Match Alert (2)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select 80%+' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select all' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Deselect All' })).toBeTruthy();
  });

  it('shows six targets without an inner scroller and expands the rest in place', async () => {
    radar.loadMatchEvents.mockResolvedValue([
      scoredEvent('e1', [99, 95, 90, 88, 85, 82, 70, 60]),
    ]);
    renderRadar(newClient());

    await screen.findByText('Buyer 0');
    const rows = screen.getAllByRole('checkbox');
    expect(rows).toHaveLength(6);
    expect(rows[0].parentElement?.className).not.toContain('overflow-y-auto');
    expect(screen.queryByText('Buyer 6')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show all 8' }));

    expect(screen.getAllByRole('checkbox')).toHaveLength(8);
    expect(screen.getByText('Buyer 7')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
    expect(screen.getByText('Send Match Alert (6)')).toBeTruthy();
  });

  it('labels dismiss as hiding the alert, dates the card unambiguously and flags an implausible sale price', async () => {
    const event = scoredEvent('e1', [100]);
    event.property = {
      id: 'prop-e1',
      title: 'Old House on 60x90 Plot',
      price: 40_000,
      listing_type: 'Sale',
    } as MatchEvent['property'];
    radar.loadMatchEvents.mockResolvedValue([event]);
    renderRadar(newClient());

    expect(
      await screen.findByText(/Price looks wrong, check the listing/)
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Open listing' }).getAttribute('href')
    ).toBe('/inventory?propertyId=prop-e1');
    expect(
      screen.getByRole('button', { name: 'Dismiss' }).getAttribute('title')
    ).toBe('Hide this alert');
    expect(
      screen.getByText(/^\d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d{2} (am|pm)$/)
    ).toBeTruthy();
  });
});
