// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// A confidential listing's own share link must open its gate.
//
// Share links name a listing by its property code. The teaser
// reduction strips property_code — deliberately, it is a handle that
// identifies the property — so the catalog could not match the code to
// the row and the detail modal never opened. The recipient of a link
// sent FOR that listing landed on the general grid with no route to
// "Request full details", which reads as a dead link.
//
// The server now translates the code to the row's id before handing it
// over (src/app/page.tsx). These tests pin both halves of why that is
// needed: the id opens the gate, the code cannot.
// ============================================================

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import type { Property, ShowcaseSettings } from '@/types';
import { toTeaserPropertyView } from '@/lib/inventory/showcase-visibility';

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

// Reduced through the real serializer, so the test cannot drift from
// what a visitor actually receives.
const teaser = toTeaserPropertyView({
  id: 'cf0216ef-ba96-48cf-b2c2-f8c6092a14f7',
  account_id: 'acct-1',
  title: '4 BHK Independent Bungalow in HSR Layout',
  description: 'Owner Mr Rao, next to the temple.',
  price: 165000000,
  location: 'HSR Layout, Bengaluru',
  sublocality: 'HSR Layout',
  city: 'Bengaluru',
  type: 'Residential House',
  status: 'Available',
  listing_type: 'Sale',
  bedrooms: 4,
  is_published: true,
  features: [],
  images: [],
  private_images: ['property-images-private/acct-1/a.jpg'],
  property_code: 'PROP-1194',
  showcase_visibility: 'teaser',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as unknown as Property);

const settings = {
  id: 's1',
  account_id: 'acct-1',
  is_active: true,
} as unknown as ShowcaseSettings;

function renderWith(initialPropertyId: string) {
  render(
    <ShowcaseView
      properties={[teaser]}
      settings={settings}
      accountId="acct-1"
      initialPropertyId={initialPropertyId}
    />
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

describe('teaser deep link', () => {
  it('strips the property code, so the code cannot address it', () => {
    expect(teaser.property_code).toBeUndefined();
  });

  it('opens the gate when addressed by the row id', () => {
    renderWith(teaser.id);
    expect(screen.getAllByText(/request full details/i).length).toBeGreaterThan(
      0
    );
  });

  // The reported failure: the link carried PROP-1194 and nothing opened.
  // Kept as a test so the server-side translation is never dropped as
  // redundant — without it this is what a recipient sees.
  it('cannot open the gate when addressed by the stripped code', () => {
    renderWith('PROP-1194');
    expect(screen.queryByText(/request full details/i)).toBeNull();
  });
});
