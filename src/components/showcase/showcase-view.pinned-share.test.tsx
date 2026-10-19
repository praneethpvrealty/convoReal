// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// [PRP-005] A share token's pinned listings open the catalog on exactly
// those listings, the way ?ids= in the URL does. The server resolves
// ?s= to the pins (src/app/(showcase)/page.tsx) and hands them over as
// initialIds; the URL stays one token long.
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

const listing = (id: string, code: string, title: string) =>
  ({
    id,
    account_id: 'acct-1',
    title,
    description: '',
    price: 210000000,
    location: 'Koramangala East, Bengaluru',
    sublocality: 'Koramangala East',
    city: 'Bengaluru',
    type: 'Commercial Office Space',
    status: 'Available',
    listing_type: 'Sale',
    is_published: true,
    features: [],
    images: [],
    property_code: code,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }) as unknown as Property;

const properties = [
  listing('p-1', 'PROP-2263', 'Office on 80 Feet Road'),
  listing('p-2', 'PROP-2249', 'Corner plot in Dharmagiri'),
  listing('p-3', 'PROP-1194', 'Showroom in BTM Layout'),
];

const settings = {
  id: 's1',
  account_id: 'acct-1',
  is_active: true,
} as unknown as ShowcaseSettings;

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

describe('pinned share', () => {
  it('opens only the listings the token pinned, in their order', () => {
    window.history.replaceState({}, '', '/?s=share-1');
    render(
      <ShowcaseView
        properties={properties}
        settings={settings}
        accountId="acct-1"
        shareId="share-1"
        initialIds={['PROP-2249', 'PROP-2263']}
      />
    );
    const titles = screen
      .getAllByText(/Office on 80 Feet Road|Corner plot|Showroom/)
      .map((node) => node.textContent);
    expect(titles[0]).toContain('Corner plot');
    expect(titles.some((t) => t?.includes('Office on 80 Feet Road'))).toBe(
      true
    );
    expect(screen.queryByText(/Showroom in BTM Layout/)).toBeNull();
  });

  it('a plain tracking token leaves the catalog whole', () => {
    window.history.replaceState({}, '', '/?s=share-2');
    render(
      <ShowcaseView
        properties={properties}
        settings={settings}
        accountId="acct-1"
        shareId="share-2"
        initialIds={[]}
      />
    );
    expect(
      screen.getAllByText(/Showroom in BTM Layout/).length
    ).toBeGreaterThan(0);
  });
});
