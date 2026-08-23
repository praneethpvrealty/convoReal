// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { Property, ShowcaseSettings } from '@/types';

vi.mock('@/lib/pulse/tracker', () => ({
  createShowcaseTracker: () => ({ track: vi.fn(), flush: vi.fn() }),
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
});
