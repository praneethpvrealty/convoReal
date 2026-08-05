// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// The detail modal's Share control — the one a buyer uses to forward a
// listing to a friend.
//
// The assertion that earns this file is the last one: the link it hands
// out must never carry the share grant (?g=). A grant unmasks the exact
// address, the pin and the guarded photos for whoever holds the link,
// and the agent granted it to ONE recipient. Copying the current URL
// instead of rebuilding it would forward that unmasking to everyone the
// buyer shares with, silently.
// ============================================================

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

const GRANT_TOKEN = 'g'.repeat(48);

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
} as unknown as ShowcaseSettings;

function renderAt(search: string, grantToken?: string, agentMode = false) {
  window.history.replaceState({}, '', `/${search}`);
  const writeText = vi.fn<(text: string) => Promise<void>>();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  render(
    <ShowcaseView
      properties={[property]}
      settings={settings}
      accountId="acct-1"
      initialPropertyId={property.id}
      shareGrantToken={grantToken}
      initialAgentMode={agentMode}
      disableSavedState
    />
  );
  return writeText;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('showcase detail — share control', () => {
  it('offers a share control on the open listing', () => {
    renderAt('');
    expect(
      screen.getByRole('button', { name: /share this property/i })
    ).toBeTruthy();
  });

  it('copies a link addressed to the listing when the device cannot share', () => {
    const writeText = renderAt('');

    fireEvent.click(
      screen.getByRole('button', { name: /share this property/i })
    );

    expect(writeText).toHaveBeenCalledTimes(1);
    const url = new URL(writeText.mock.calls[0][0]);
    expect(url.searchParams.get('property_id')).toBe('CR-001');
  });

  it('carries the referrer through so the recipient lands on the same catalog', () => {
    const writeText = renderAt('?ref=acct-1');

    fireEvent.click(
      screen.getByRole('button', { name: /share this property/i })
    );

    const url = new URL(writeText.mock.calls[0][0]);
    expect(url.searchParams.get('ref')).toBe('acct-1');
  });

  it('leaves a co-broker with the attributed link instead', () => {
    renderAt('', undefined, true);

    expect(
      screen.queryByRole('button', { name: /share this property/i })
    ).toBeNull();
    expect(screen.getByText(/get my share link/i)).toBeTruthy();
  });

  it('never forwards the share grant that unmasked this visit', () => {
    const writeText = renderAt(`?g=${GRANT_TOKEN}&v=contact-9`, GRANT_TOKEN);

    fireEvent.click(
      screen.getByRole('button', { name: /share this property/i })
    );

    const shared = writeText.mock.calls[0][0];
    expect(shared).not.toContain(GRANT_TOKEN);
    expect(shared).not.toContain('g=');
    // The per-contact visitor token is Pulse identity, not the sharer's
    // to hand on either — the recipient must count as their own visitor.
    expect(shared).not.toContain('v=contact-9');
  });
});
