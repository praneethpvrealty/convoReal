// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// The showcase must render for a visitor who has blocked site data.
//
// Chrome with cookies/site data blocked does not hand back null from
// `localStorage` — reading the property throws SecurityError. The
// showcase read it unguarded while restoring saved filters, so the
// whole page fell to the error boundary. A co-broker hit "Our Agent Is
// Running Late" on every open of a link that served a correct 200,
// while the same link worked for everyone else; the setting is
// per-site and sticky, so to him the product was simply broken.
//
// Storage is a convenience here — a remembered filter, a name typed
// once. Losing it is a worse session. Throwing is a blank page.
// ============================================================

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import type { Property, ShowcaseSettings } from '@/types';

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
    )
  );
});

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

const property = {
  id: 'prop-1',
  account_id: 'acct-1',
  title: 'Sarjapur JV Land',
  price: 220000000,
  location: 'Sarjapur, Bangalore',
  sublocality: 'Sarjapur',
  city: 'Bangalore',
  type: 'Residential Land/ Plot',
  status: 'Available',
  listing_type: 'Sale',
  is_published: true,
  features: [],
  images: ['property-images/acct-1/img-1.jpg'],
  property_code: 'CR-001',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as unknown as Property;

const settings = {
  id: 's1',
  account_id: 'acct-1',
  is_active: true,
} as unknown as ShowcaseSettings;

const realLocalStorage = Object.getOwnPropertyDescriptor(
  window,
  'localStorage'
);

/** Exactly what the reported device did: the property access itself
 *  throws, so a try around the method call alone would not have helped. */
function blockSiteData() {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException(
        "Failed to read the 'localStorage' property from 'Window': Access is denied for this document.",
        'SecurityError'
      );
    },
  });
}

afterEach(() => {
  if (realLocalStorage) {
    Object.defineProperty(window, 'localStorage', realLocalStorage);
  }
  cleanup();
  window.history.replaceState({}, '', '/');
});

describe('showcase with site data blocked', () => {
  it('still renders the catalog', () => {
    blockSiteData();
    expect(() =>
      render(
        <ShowcaseView
          properties={[property]}
          settings={settings}
          accountId="acct-1"
        />
      )
    ).not.toThrow();
    expect(screen.getByText('Sarjapur JV Land')).toBeTruthy();
  });

  // The reported URL was a deep link: ?property_id=... opens the detail
  // modal during the same mount that reads storage.
  it('still opens a deep-linked listing', () => {
    blockSiteData();
    window.history.replaceState({}, '', '/?property_id=CR-001');
    expect(() =>
      render(
        <ShowcaseView
          properties={[property]}
          settings={settings}
          accountId="acct-1"
          initialPropertyId="CR-001"
        />
      )
    ).not.toThrow();
    expect(screen.getAllByText('Sarjapur JV Land').length).toBeGreaterThan(0);
  });
});
