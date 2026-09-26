// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import {
  render,
  cleanup,
  screen,
  fireEvent,
  within,
} from '@testing-library/react';
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

function property(overrides: Partial<Property>): Property {
  return {
    id: overrides.id ?? 'p',
    account_id: 'acct-1',
    user_id: null,
    title: 'Listing',
    price: 50_000_000,
    location: `${overrides.sublocality ?? 'Koramangala'}, Bengaluru`,
    sublocality: 'Koramangala',
    city: 'Bengaluru',
    type: 'Villa',
    status: 'Available',
    listing_type: 'Sale',
    is_published: true,
    features: [],
    images: ['property-images/acct-1/img.jpg'],
    location_guarded: true,
    location_revealed: false,
    private_images_revealed: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Property;
}

const villa = property({
  id: 'villa',
  title: 'North-facing villa in Kasavanahalli',
  price: 67_900_000,
  property_code: 'CR-101',
  type: 'Villa',
  sublocality: 'Kasavanahalli',
});
const plot = property({
  id: 'plot',
  title: 'East-facing plot in Vijaya Bank Layout',
  price: 60_000_000,
  property_code: 'CR-102',
  type: 'Residential Land/ Plot',
  sublocality: 'Vijaya Bank Layout',
  images: [],
  dimensions: '60x40',
  land_area: 2400,
  land_area_unit: 'Sq.Ft.',
  facing_direction: 'East',
  road_width: 40,
  road_width_unit: 'ft',
});
const building = property({
  id: 'building',
  title: 'Commercial building with bank tenant',
  price: 320_000_000,
  property_code: 'CR-103',
  type: 'Commercial Building',
  sublocality: 'Domlur',
});
const rental = property({
  id: 'rental',
  title: 'Furnished 2 BHK',
  price: 0,
  listing_type: 'Rent',
  rent_per_month: 150_000,
  property_code: 'CR-104',
  type: 'Flat/ Apartment',
});

const settings = {
  id: 's1',
  account_id: 'acct-1',
  is_active: true,
  contact_phone: '+919900277111',
} as unknown as ShowcaseSettings;

function renderDealFloor(style: 'deal-floor' | 'quiet-luxury' = 'deal-floor') {
  window.history.replaceState({}, '', '/');
  render(
    <ShowcaseView
      properties={[villa, plot, building, rental]}
      settings={settings}
      accountId="acct-1"
      siteName="Aryavarta Ventures"
      showcaseStyle={style}
      designFontClassName="df-fonts"
      disableSavedState
    />
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Deal Floor showcase design [PRP-020]', () => {
  it('is only drawn for the deal-floor style', () => {
    renderDealFloor('quiet-luxury');
    expect(
      screen.queryByRole('combobox', { name: 'Property kind' })
    ).toBeNull();
    expect(screen.queryByRole('group', { name: 'Browse mode' })).toBeNull();
    expect(screen.getByText('No Photos Available')).toBeTruthy();
  });

  it('renders the fill-in-the-blank hero, kind tiles with counts and the font class', () => {
    renderDealFloor();
    const surface = document.querySelector('.showcase-surface');
    expect(surface?.getAttribute('data-showcase-design')).toBe('deal-floor');
    expect(surface?.className).toContain('df-fonts');

    expect(
      screen.getByRole('combobox', { name: 'Property kind' })
    ).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Locality' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Budget' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /See 4 matches/ })).toBeTruthy();

    const kinds = within(
      screen.getByRole('region', { name: 'Browse by kind' })
    );
    expect(kinds.getByRole('button', { name: /^4\s*All$/ })).toBeTruthy();
    expect(
      kinds.getByRole('button', { name: /^1\s*Houses & villas$/ })
    ).toBeTruthy();
    expect(
      kinds.getByRole('button', { name: /^1\s*Residential plots$/ })
    ).toBeTruthy();
    expect(kinds.getByRole('button', { name: /^1\s*Flats$/ })).toBeTruthy();
  });

  it('drives the catalogue from the hero blanks: kind, locality and budget narrow the same grid', () => {
    renderDealFloor();
    const grid = () => within(screen.getByLabelText('Property listings'));

    fireEvent.change(screen.getByRole('combobox', { name: 'Property kind' }), {
      target: { value: 'kind:houses' },
    });
    expect(screen.getByRole('button', { name: /See 1 match$/ })).toBeTruthy();
    expect(grid().getByText(villa.title)).toBeTruthy();
    expect(grid().queryByText(plot.title)).toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'Property kind' }), {
      target: { value: 'All' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Budget' }), {
      target: { value: String(80_000_000) },
    });
    expect(screen.getByRole('button', { name: /See 3 matches/ })).toBeTruthy();
    expect(grid().queryByText(building.title)).toBeNull();
    expect(grid().getByText(rental.title)).toBeTruthy();
    expect(grid().getByText(plot.title)).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Locality' }), {
      target: { value: 'Kasavanahalli' },
    });
    expect(screen.getByRole('button', { name: /See 1 match$/ })).toBeTruthy();
    expect(grid().getByText(villa.title)).toBeTruthy();
  });

  it('draws a plot face from the listing fields instead of "No Photos Available"', () => {
    renderDealFloor();
    expect(screen.queryByText('No Photos Available')).toBeNull();
    const face = screen.getByRole('img', {
      name: '60x40, 2,400 Sq.Ft. · East facing, 40 ft road',
    });
    expect(face).toBeTruthy();
  });

  it('features the priciest photographed sale listing and counts localities on the board', () => {
    renderDealFloor();
    const board = within(
      screen.getByRole('region', { name: 'This week on the floor' })
    );
    const featured = board.getByRole('button', { name: /Featured/ });
    expect(featured.textContent).toContain(building.title);
    expect(featured.textContent).toContain('₹32 Cr');
    expect(board.getByRole('button', { name: '1 in Domlur' })).toBeTruthy();
    expect(board.getByRole('button', { name: '1 Koramangala' })).toBeTruthy();
    expect(
      board.getByRole('button', { name: 'Answer 3 quick questions instead' })
    ).toBeTruthy();

    fireEvent.click(board.getByRole('button', { name: '1 Koramangala' }));
    expect(screen.getByRole('button', { name: /See 1 match$/ })).toBeTruthy();
    expect(
      within(screen.getByLabelText('Property listings')).getByText(rental.title)
    ).toBeTruthy();
  });

  it('plays Quick Picks against the live shortlist and offers the report after three picks', () => {
    renderDealFloor();
    fireEvent.click(
      screen.getByRole('button', { name: /or play Quick Picks/ })
    );
    const deck = () =>
      within(screen.getByRole('region', { name: 'Quick Picks' }));

    expect(deck().getByText('Quick Picks · 1 of 4')).toBeTruthy();
    expect(deck().getByRole('heading', { name: villa.title })).toBeTruthy();

    fireEvent.click(deck().getByRole('button', { name: 'Shortlist' }));
    expect(screen.getByText('1 shortlisted')).toBeTruthy();
    expect(deck().getByRole('heading', { name: building.title })).toBeTruthy();

    fireEvent.click(deck().getByRole('button', { name: 'Undo' }));
    expect(screen.queryByText('1 shortlisted')).toBeNull();
    expect(deck().getByRole('heading', { name: villa.title })).toBeTruthy();

    fireEvent.click(deck().getByRole('button', { name: 'Shortlist' }));
    fireEvent.click(deck().getByRole('button', { name: 'Shortlist' }));
    fireEvent.click(
      deck().getByRole('button', { name: `Skip ${rental.title}` })
    );
    expect(deck().getByRole('heading', { name: plot.title })).toBeTruthy();
    fireEvent.click(deck().getByRole('button', { name: 'Shortlist' }));

    const done = within(
      screen.getByRole('region', { name: 'Quick Picks round complete' })
    );
    expect(done.getByText('You lean towards houses & villas.')).toBeTruthy();
    expect(screen.getByText('3 shortlisted')).toBeTruthy();

    fireEvent.click(
      done.getByRole('button', { name: /Send my 3 picks on WhatsApp/ })
    );
    expect(screen.getByRole('dialog', { name: 'Your shortlist' })).toBeTruthy();
  });
});
