// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// Guards the wiring between a share grant and what a buyer actually
// sees on the showcase detail view.
//
// The grant's decision is made in location-guard.ts (covered by its own
// unit tests) and arrives here as three flags on the property:
// `location_revealed`, `documents`, and `private_images_revealed`.
// Nothing tested the step after that — whether those flags reach the
// right JSX. That gap is the one that silently ships a link the agent
// believes is unmasked and the buyer sees masked.
//
// The run prints a few "Iframe page loading is disabled" notices. That
// is the environment option above doing its job: the map block mounts a
// real <iframe>, and this stops the DOM environment reaching out to
// Google for it. The assertions read the src attribute, not the frame.
//
// WHAT THIS CANNOT DO: it renders the client component with a
// pre-reduced property, so it does not prove the server resolved ?g=
// or that the guard reduced the row correctly — those are covered in
// share-grants.test.ts and location-guard.test.ts. What it proves is
// that a property carrying the granted flags renders the map, the
// documents and the guarded photos, and that one carrying none of them
// still renders the masked block and the request prompts.
// ============================================================

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import type { Property, ShowcaseSettings } from '@/types';

// The view polls its ratings endpoint on mount and the map block mounts
// a real <iframe>; the DOM environment would try to reach both over the
// network and log the refusals. Stubbing fetch keeps the run offline
// and the output readable — the assertions below never depend on it.
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

const GRANT_TOKEN = 'g'.repeat(48);
const MAP_LINK = 'https://maps.google.com/?q=12.9348,77.6189';

const baseProperty = {
  id: 'prop-1',
  account_id: 'acct-1',
  title: 'Sarjapur JV Land',
  description: 'A premium joint venture opportunity.',
  price: 220000000,
  location: 'HSR Layout, Bangalore',
  sublocality: 'Sarjapur',
  city: 'Bangalore',
  state: 'Karnataka',
  type: 'Residential Land/ Plot',
  status: 'Available',
  listing_type: 'Sale',
  is_published: true,
  features: [],
  images: ['property-images/acct-1/img-1.jpg'],
  property_code: 'CR-001',
  private_images_count: 2,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as unknown as Property;

/** A row as the guard reduces it for a buyer with no grant. */
const maskedProperty = {
  ...baseProperty,
  location: 'Sarjapur, Bangalore',
  google_map_link: null,
  location_guarded: true,
  location_revealed: false,
  private_images_revealed: false,
} as unknown as Property;

/** The same row once a grant opened everything. */
const grantedProperty = {
  ...baseProperty,
  google_map_link: MAP_LINK,
  location_guarded: false,
  location_revealed: true,
  private_images_revealed: true,
  documents: [
    JSON.stringify({
      url: 'property-documents/acct-1/doc-1234-Sale_Deed.pdf',
      title: 'Sale Deed',
    }),
    'property-documents/acct-1/doc-5678-Khata.pdf',
  ],
} as unknown as Property;

const settings = {
  id: 's1',
  account_id: 'acct-1',
  is_active: true,
} as unknown as ShowcaseSettings;

function renderShowcase(property: Property, grantToken?: string) {
  return render(
    <ShowcaseView
      properties={[property]}
      settings={settings}
      accountId="acct-1"
      initialPropertyId={property.id}
      shareGrantToken={grantToken}
      disableSavedState
    />
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('showcase detail — no grant (the default a buyer link gets)', () => {
  it('masks the address and offers the request prompts', () => {
    renderShowcase(maskedProperty);

    expect(screen.getByText(/exact address masked/i)).toBeTruthy();
    expect(
      screen.getAllByText(/request exact location/i).length
    ).toBeGreaterThan(0);
    expect(screen.getByText(/request property documents/i)).toBeTruthy();
  });

  it('renders no map embed', () => {
    const { container } = renderShowcase(maskedProperty);
    expect(
      container.querySelector('iframe[title="Property Location"]')
    ).toBeNull();
  });

  it('offers the guarded photos on request rather than showing them', () => {
    const { container } = renderShowcase(maskedProperty);
    expect(screen.getByText(/2 more photos/i)).toBeTruthy();
    expect(
      container.querySelector('img[src*="/api/public/share-grant/"]')
    ).toBeNull();
  });
});

describe('showcase detail — granted link', () => {
  it('shows the map embed and the pin link', () => {
    const { container } = renderShowcase(grantedProperty, GRANT_TOKEN);

    const iframe = container.querySelector('iframe[title="Property Location"]');
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute('src')).toContain('output=embed');
    // The embed and the link resolve from the same pin, so the iframe
    // can never sit on a different place from the link above it.
    expect(iframe?.getAttribute('src')).toContain('12.9348,77.6189');
    expect(
      container.querySelector(
        'a[href="https://www.google.com/maps/search/?api=1&query=12.9348,77.6189"]'
      )
    ).toBeTruthy();
  });

  it('stands the masked block and its request prompt down', () => {
    renderShowcase(grantedProperty, GRANT_TOKEN);
    expect(screen.queryByText(/exact address masked/i)).toBeNull();
    expect(screen.queryByText(/request exact location/i)).toBeNull();
  });

  it('lists the documents, titled, in place of the request prompt', () => {
    renderShowcase(grantedProperty, GRANT_TOKEN);

    expect(screen.getByText(/property documents \(2\)/i)).toBeTruthy();
    expect(screen.getByText('Sale Deed')).toBeTruthy();
    // The untitled one falls back to its filename, upload prefix stripped.
    expect(screen.getByText('Khata.pdf')).toBeTruthy();
    expect(screen.queryByText(/request property documents/i)).toBeNull();
  });

  it('addresses each guarded photo through the token proxy', () => {
    const { container } = renderShowcase(grantedProperty, GRANT_TOKEN);
    const thumbs = Array.from(
      container.querySelectorAll('img[src*="/api/public/share-grant/"]')
    ).map((el) => el.getAttribute('src'));

    expect(thumbs).toContain(`/api/public/share-grant/${GRANT_TOKEN}/image/0`);
    expect(thumbs).toContain(`/api/public/share-grant/${GRANT_TOKEN}/image/1`);
  });

  it('keeps the guarded photos out of the payload as paths', () => {
    const { container } = renderShowcase(grantedProperty, GRANT_TOKEN);
    expect(container.innerHTML).not.toContain('property-images-private');
  });
});

describe('showcase detail — grant flags without the token', () => {
  // Defence in depth: the flag alone must not fabricate image URLs, or a
  // cached/replayed payload would render broken <img> tags pointing at a
  // proxy path with no token in it.
  it('renders no guarded photos when the token is missing', () => {
    const { container } = renderShowcase(grantedProperty, undefined);
    expect(
      container.querySelector('img[src*="/api/public/share-grant/"]')
    ).toBeNull();
  });
});
