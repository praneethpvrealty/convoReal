// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { Property } from '@/types';

vi.mock('next/dynamic', () => ({
  default: () =>
    function MapStub() {
      return <div data-testid="interactive-map" />;
    },
}));

import { ShowcaseMap } from './showcase-map';

function listing(
  id: string,
  title: string,
  sublocality: string,
  pinned: boolean
): Property {
  return {
    id,
    title,
    sublocality,
    city: 'Bangalore',
    type: 'Apartment',
    status: 'Available',
    listing_type: 'Sale',
    price: 10000000,
    latitude: pinned ? 12.97 : null,
    longitude: pinned ? 77.75 : null,
    location_guarded: !pinned,
    location_revealed: pinned,
  } as unknown as Property;
}

const pinnedA = listing('a', 'Whitefield Flat', 'Whitefield', true);
const pinnedB = listing('b', 'Whitefield Villa', 'Whitefield', true);
const areaOnly = listing('c', 'Hebbal Plot', 'Hebbal', false);

function renderMap(properties: Property[], withAction = true) {
  render(
    <ShowcaseMap
      properties={properties}
      currency="INR"
      onOpen={() => {}}
      shortlistedPropertyIds={[]}
      onClose={() => {}}
      renderListingAction={
        withAction
          ? (property) => <span>{`action ${property.id}`}</span>
          : undefined
      }
    />
  );
}

const rows = () =>
  within(screen.getByRole('list', { name: 'Listings on this map' }));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('ShowcaseMap listing actions', () => {
  it('[PRP-053] lists every pinned listing with its action on the interactive map', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY', 'test-browser-key');
    renderMap([pinnedA, pinnedB]);
    expect(screen.getByTestId('interactive-map')).toBeTruthy();
    expect(rows().getByText('action a')).toBeTruthy();
    expect(rows().getByText('action b')).toBeTruthy();
  });

  it('[PRP-053] lists only the focused listing on the embedded map without a key', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY', '');
    renderMap([pinnedA, pinnedB]);
    expect(rows().getByText('action a')).toBeTruthy();
    expect(rows().queryByText('action b')).toBeNull();

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Property on map' }),
      { target: { value: 'b' } }
    );
    expect(rows().getByText('action b')).toBeTruthy();
    expect(rows().queryByText('action a')).toBeNull();
  });

  it('[PRP-053] lists the selected area’s listings when no exact pin is shared', () => {
    renderMap([areaOnly]);
    expect(screen.getByRole('combobox', { name: 'Area on map' })).toBeTruthy();
    expect(rows().getByText('action c')).toBeTruthy();
  });

  it('[PRP-053] adds no list when the page offers no action', () => {
    renderMap([pinnedA, areaOnly], false);
    expect(
      screen.queryByRole('list', { name: 'Listings on this map' })
    ).toBeNull();
  });
});
