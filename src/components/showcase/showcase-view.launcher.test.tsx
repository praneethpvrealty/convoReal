// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// The floating "Find my property" launcher and the listing panel's
// sticky action footer both live on the bottom edge of a phone screen.
// While a listing is open the launcher steps aside, so the Enquire
// button is never covered; it returns when the panel closes.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import type { Property, ShowcaseSettings } from '@/types';

vi.mock('@/lib/pulse/tracker', () => ({
  createShowcaseTracker: () => ({ track: vi.fn(), flush: vi.fn() }),
}));
vi.mock('@/components/showcase/ask-property-chat', () => ({
  AskPropertyChat: () => null,
}));
vi.mock('@/components/showcase/similar-properties', () => ({
  SimilarProperties: () => null,
}));
vi.mock('@/components/showcase/add-to-inventory', () => ({
  AddToInventory: () => null,
  useShowcaseImportViewers: () => ({ offersImport: false }),
}));

import { ShowcaseView } from './showcase-view';

const property = {
  id: 'prop-1',
  account_id: 'acct-1',
  title: 'Plot in JP Nagar 3rd Phase',
  price: 95000000,
  location: 'JP Nagar, Bengaluru',
  sublocality: 'JP Nagar',
  city: 'Bengaluru',
  type: 'Residential Land/ Plot',
  status: 'Available',
  listing_type: 'Sale',
  is_published: true,
  features: [],
  images: ['property-images/acct-1/prop-1.jpg'],
  property_code: 'PROP-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as unknown as Property;

const settings = {
  id: 's1',
  account_id: 'acct-1',
  is_active: true,
  contact_phone: '+919900277111',
} as unknown as ShowcaseSettings;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
    )
  );
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('[PRP-058] floating launcher and listing footer', () => {
  it('hides the launcher while a listing is open and brings it back on close', () => {
    render(
      <ShowcaseView
        properties={[property]}
        settings={settings}
        accountId="acct-1"
        initialPropertyId={property.id}
        disableSavedState
      />
    );
    expect(
      document.querySelector('[data-showcase-detail-actions]')
    ).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: /find my property/i })
    ).toBeNull();

    fireEvent.click(
      document.querySelector('.fixed.inset-0.z-50 button') as HTMLElement
    );
    expect(document.querySelector('[data-showcase-detail-actions]')).toBeNull();
    expect(
      screen.getByRole('button', { name: /find my property/i })
    ).toBeTruthy();
  });
});
