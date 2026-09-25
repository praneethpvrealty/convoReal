// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

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

const askChat = vi.hoisted(() => vi.fn(() => null));

vi.mock('@/lib/pulse/tracker', () => ({
  createShowcaseTracker: () => ({ track: vi.fn(), flush: vi.fn() }),
}));
vi.mock('@/components/showcase/ask-property-chat', () => ({
  AskPropertyChat: askChat,
}));
vi.mock('@/components/showcase/showcase-lead-bot', () => ({
  ShowcaseLeadBot: () => null,
}));
vi.mock('@/components/showcase/similar-properties', () => ({
  SimilarProperties: () => null,
}));

import { ShowcaseView } from './showcase-view';

function listing(status: string): Property {
  return {
    id: 'prop-1',
    account_id: 'acct-1',
    title: 'Corner Residential Plot',
    price: 90000000,
    location: 'Basavanagudi, Bengaluru',
    sublocality: 'Basavanagudi',
    city: 'Bengaluru',
    type: 'Residential Land/ Plot',
    status,
    listing_type: 'Sale',
    is_published: true,
    features: [],
    images: [],
    property_code: 'PROP-1767',
    location_guarded: true,
    location_revealed: false,
    private_images_revealed: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as unknown as Property;
}

const settings = {
  id: 's1',
  account_id: 'acct-1',
  is_active: true,
  contact_phone: '+919900277111',
} as unknown as ShowcaseSettings;

function renderListing(status: string) {
  const property = listing(status);
  render(
    <ShowcaseView
      properties={[property]}
      settings={settings}
      accountId="acct-1"
      initialPropertyId={property.id}
      disableSavedState
    />
  );
}

function inquiryText(): string {
  const link = screen
    .getAllByRole('link', { name: /whatsapp inquiry/i })[0]
    .getAttribute('href');
  return new URL(link!).searchParams.get('text') ?? '';
}

afterEach(() => {
  cleanup();
  askChat.mockClear();
  localStorage.clear();
});

describe('showcase detail — listing availability', () => {
  it('[PRP-014] tells the enquirer an under-contract listing can still be checked with the owner', () => {
    renderListing('Under Contract');
    const notice = screen.getByRole('status');
    expect(notice.textContent).toMatch(/under contract/i);
    expect(notice.textContent).toMatch(/check with the listing owner/i);
    expect(inquiryText()).toContain(
      'I see it is marked "Under Contract" — could you share its latest status?'
    );
    expect(askChat).not.toHaveBeenCalled();
  });

  it('[PRP-014] explains a sold listing the same way', () => {
    renderListing('Sold');
    expect(screen.getByRole('status').textContent).toMatch(/already sold/i);
    expect(inquiryText()).toContain('marked "Sold"');
  });

  it('[PRP-014] shows no notice for an available listing', () => {
    renderListing('Available');
    expect(screen.queryByText(/check with the listing owner/i)).toBeNull();
    expect(inquiryText()).not.toMatch(/latest status/);
    expect(askChat).toHaveBeenCalled();
  });
});
