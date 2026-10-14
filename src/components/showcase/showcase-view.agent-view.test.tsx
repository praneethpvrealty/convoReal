// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
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
  images: [],
  property_code: 'CR-001',
  location_guarded: true,
  location_revealed: false,
  private_images_revealed: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as unknown as Property;

const settings = {
  id: 's1',
  account_id: 'acct-1',
  is_active: true,
  contact_phone: '+919900277111',
} as unknown as ShowcaseSettings;

function renderAgentView(initialPropertyId?: string) {
  render(
    <ShowcaseView
      properties={[property]}
      settings={settings}
      accountId="acct-1"
      initialPropertyId={initialPropertyId}
      initialAgentMode
      disableSavedState
    />
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('showcase agent view (mode=view) — shortlist', () => {
  it('[PRP-047] shortlists from the open listing without the buyer forms', () => {
    renderAgentView(property.id);
    const button = screen.getByRole('button', {
      name: 'Shortlist Sarjapur JV Land',
    });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toMatch(/shortlisted/i);
    expect(screen.queryByText(/how well does this fit/i)).toBeNull();
    expect(
      screen.queryByRole('button', { name: /submit lead form/i })
    ).toBeNull();
  });

  it('[PRP-047] shortlists from the grid and offers the shortlist enquiry', () => {
    renderAgentView();
    fireEvent.click(
      screen.getByRole('button', { name: 'Shortlist Sarjapur JV Land' })
    );
    expect(screen.getByText('1 shortlisted')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /enquire about selected/i })
    ).toBeTruthy();
  });
});
