// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Property, ShowcaseSettings } from '@/types';

const { trackPulseEvent } = vi.hoisted(() => ({
  trackPulseEvent: vi.fn(),
}));

vi.mock('@/lib/pulse/tracker', () => ({
  createShowcaseTracker: () => ({ track: trackPulseEvent, flush: vi.fn() }),
}));
vi.mock('@/components/showcase/ask-property-chat', () => ({
  AskPropertyChat: () => null,
}));
vi.mock('@/components/showcase/showcase-lead-bot', () => ({
  ShowcaseLeadBot: () => null,
}));
vi.mock('@/components/showcase/similar-properties', () => ({
  SimilarProperties: () => null,
}));

import { ShowcaseView } from './showcase-view';

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
    )
  );
});

const settings = {
  id: 'settings-1',
  account_id: 'account-1',
  is_active: true,
} as unknown as ShowcaseSettings;

const properties = [
  {
    id: 'koramangala',
    account_id: 'account-1',
    title: 'Koramangala Villa',
    price: 20000000,
    location: 'Koramangala, Bengaluru',
    sublocality: 'Koramangala',
    city: 'Bengaluru',
    type: 'Villa',
    status: 'Available',
    listing_type: 'Sale',
    is_published: true,
    features: [],
    images: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'indiranagar',
    account_id: 'account-1',
    title: 'Indiranagar Apartment',
    price: 10000000,
    location: 'Indiranagar, Bengaluru',
    sublocality: 'Indiranagar',
    city: 'Bengaluru',
    type: 'Flat/ Apartment',
    status: 'Available',
    listing_type: 'Sale',
    is_published: true,
    features: [],
    images: [],
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
] as unknown as Property[];

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  cleanup();
  localStorage.clear();
});

describe('showcase location picker', () => {
  it('adds a location chip and filters the catalog to that location', () => {
    render(
      <ShowcaseView
        properties={properties}
        settings={settings}
        accountId="account-1"
        disableSavedState
      />
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Search locations' }), {
      target: { value: 'Kora' },
    });
    fireEvent.click(screen.getByRole('option', { name: 'Koramangala' }));

    expect(screen.getByText('Locations:')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Koramangala' })).toBeTruthy();
    expect(screen.getByText('Koramangala Villa')).toBeTruthy();
    expect(screen.queryByText('Indiranagar Apartment')).toBeNull();
  });

  it('applies the first matching area when Enter is pressed', () => {
    render(
      <ShowcaseView
        properties={properties}
        settings={settings}
        accountId="account-1"
        disableSavedState
      />
    );

    const input = screen.getByRole('textbox', { name: 'Search locations' });
    fireEvent.change(input, { target: { value: 'indira' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByRole('button', { name: 'Remove Indiranagar' })).toBeTruthy();
    expect(screen.queryByText('Koramangala Villa')).toBeNull();
  });

  it('[PRP-013] searches near an area no listing names and ranks results by distance', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            String(input).startsWith('/api/public/properties/near')
              ? {
                  data: {
                    label: 'Basavanagudi',
                    results: [
                      { id: 'indiranagar', tier: 'nearby', distance_km: 2.5 },
                    ],
                  },
                }
              : { data: [] }
          ),
      } as Response)
    );

    render(
      <ShowcaseView
        properties={properties}
        settings={settings}
        accountId="account-1"
        disableSavedState
      />
    );

    const input = screen.getByRole('textbox', { name: 'Search locations' });
    fireEvent.change(input, { target: { value: 'basavan' } });
    expect(screen.getByRole('option', { name: /Search near .basavan./ })).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove near Basavanagudi' })).toBeTruthy()
    );
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url) === '/api/public/properties/near?account_id=account-1&q=basavan'
      )
    ).toBe(true);
    expect(screen.getByText('No listings in Basavanagudi — showing the nearest ones.')).toBeTruthy();
    expect(screen.getByText('Indiranagar Apartment')).toBeTruthy();
    expect(screen.getByText('2.5 km away')).toBeTruthy();
    expect(screen.queryByText('Koramangala Villa')).toBeNull();
  });

  it('says when a short location has no listed area instead of showing nothing', () => {
    render(
      <ShowcaseView
        properties={properties}
        settings={settings}
        accountId="account-1"
        disableSavedState
      />
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Search locations' }), {
      target: { value: 'zz' },
    });

    expect(screen.getByText(/No listed areas match/)).toBeTruthy();
  });

  it('records the normalized property search in Showcase Pulse', () => {
    vi.useFakeTimers();
    render(
      <ShowcaseView
        properties={properties}
        settings={settings}
        accountId="account-1"
        disableSavedState
      />
    );

    fireEvent.change(
      screen.getByPlaceholderText(
        'Search properties — "2 BHK villa" or "price > 50 Cr"'
      ),
      { target: { value: '  Domlur   commercial building  ' } }
    );
    act(() => vi.advanceTimersByTime(1_000));

    expect(trackPulseEvent).toHaveBeenCalledWith('search', undefined, {
      query: 'Domlur commercial building',
    });
  });
});
