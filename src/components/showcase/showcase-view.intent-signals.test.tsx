// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// Shortlisting a listing and tapping WhatsApp on it reach Pulse as
// showcase events, so the agent sees intent that used to stay in the
// visitor's browser or go only to the Meta Pixel.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  cleanup,
  screen,
  fireEvent,
  within,
} from '@testing-library/react';
import type { Property, ShowcaseSettings } from '@/types';

const track = vi.fn();
const preventNavigation = (event: Event) => event.preventDefault();

vi.mock('@/lib/pulse/tracker', () => ({
  createShowcaseTracker: () => ({ track, flush: vi.fn() }),
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
  track.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
    )
  );
  window.history.replaceState({}, '', '/');
  document.addEventListener('click', preventNavigation);
  render(
    <ShowcaseView
      properties={[property]}
      settings={settings}
      accountId="acct-1"
      initialPropertyId={property.id}
      disableSavedState
    />
  );
});

afterEach(() => {
  document.removeEventListener('click', preventNavigation);
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('[PRP-059] showcase intent signals', () => {
  it('reports a shortlist add and remove as events on the listing', () => {
    fireEvent.click(
      screen.getAllByRole('button', {
        name: /shortlist plot in jp nagar/i,
        pressed: false,
      })[0]
    );
    expect(track).toHaveBeenCalledWith('shortlist', 'prop-1', {
      action: 'add',
    });
    fireEvent.click(
      screen.getAllByRole('button', { name: /shortlist plot in jp nagar/i })[0]
    );
    expect(track).toHaveBeenLastCalledWith('shortlist', 'prop-1', {
      action: 'remove',
    });
  });

  it('reports a removal for every listing when the shortlist is cleared', () => {
    fireEvent.click(
      screen.getAllByRole('button', {
        name: /shortlist plot in jp nagar/i,
        pressed: false,
      })[0]
    );
    fireEvent.click(
      document.querySelector('.fixed.inset-0.z-50 button') as HTMLElement
    );
    track.mockClear();
    const bar = document.querySelector(
      '[data-showcase-shortlist]'
    ) as HTMLElement;
    fireEvent.click(within(bar).getByRole('button', { name: /clear all/i }));
    expect(track).toHaveBeenCalledWith('shortlist', 'prop-1', {
      action: 'remove',
    });
  });

  it('reports a WhatsApp tap on the listing as an event', () => {
    const links = screen.getAllByRole('link', { name: /whatsapp inquiry/i });
    fireEvent.click(links[0]);
    expect(track).toHaveBeenCalledWith('whatsapp_click', 'prop-1');
  });

  it('offers the shortlist bar a WhatsApp send that reports every listing', () => {
    fireEvent.click(
      screen.getAllByRole('button', {
        name: /shortlist plot in jp nagar/i,
        pressed: false,
      })[0]
    );
    fireEvent.click(
      document.querySelector('.fixed.inset-0.z-50 button') as HTMLElement
    );
    const bar = document.querySelector(
      '[data-showcase-shortlist]'
    ) as HTMLElement;
    fireEvent.click(
      within(bar).getByRole('link', { name: /send on whatsapp/i })
    );
    expect(track).toHaveBeenCalledWith('whatsapp_click', 'prop-1', {
      shortlist: true,
    });
  });
});
