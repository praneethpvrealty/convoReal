import { describe, expect, it } from 'vitest';

import {
  favoriteLinks,
  isMenuRouteId,
  MENU_LINKS,
  MENU_ROUTE_IDS,
  MENU_SECTIONS,
  normalizeFavorites,
  toggleFavorite,
} from '@/lib/menu';

describe('menu registry', () => {
  it('places every registered route in exactly one section', () => {
    const sectioned = MENU_SECTIONS.flatMap((s) => s.ids);
    expect([...sectioned].sort()).toEqual([...MENU_ROUTE_IDS].sort());
    expect(new Set(sectioned).size).toBe(sectioned.length);
  });

  it('gives every route a distinct destination', () => {
    const hrefs = MENU_ROUTE_IDS.map((id) => MENU_LINKS[id].href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe('isMenuRouteId', () => {
  it('accepts registered ids and rejects anything else', () => {
    expect(isMenuRouteId('today')).toBe(true);
    expect(isMenuRouteId('nope')).toBe(false);
    expect(isMenuRouteId(null)).toBe(false);
    expect(isMenuRouteId(7)).toBe(false);
  });

  it('does not treat inherited object keys as routes', () => {
    expect(isMenuRouteId('toString')).toBe(false);
    expect(isMenuRouteId('constructor')).toBe(false);
  });
});

describe('normalizeFavorites', () => {
  it('keeps known ids in their pinned order', () => {
    expect(normalizeFavorites(['radar', 'today'])).toEqual(['radar', 'today']);
  });

  it('drops ids this build no longer knows', () => {
    expect(normalizeFavorites(['today', 'retired-screen'])).toEqual(['today']);
  });

  it('dedupes repeats', () => {
    expect(normalizeFavorites(['today', 'today', 'deals'])).toEqual([
      'today',
      'deals',
    ]);
  });

  it('falls back to empty for non-arrays — favourites have no default', () => {
    expect(normalizeFavorites(null)).toEqual([]);
    expect(normalizeFavorites(undefined)).toEqual([]);
    expect(normalizeFavorites('today')).toEqual([]);
    expect(normalizeFavorites({ ids: ['today'] })).toEqual([]);
  });
});

describe('toggleFavorite', () => {
  it('appends a new pin at the end', () => {
    expect(toggleFavorite(['today'], 'radar')).toEqual(['today', 'radar']);
  });

  it('removes an existing pin without disturbing the rest', () => {
    expect(toggleFavorite(['today', 'radar', 'deals'], 'radar')).toEqual([
      'today',
      'deals',
    ]);
  });

  it('does not mutate the list it was given', () => {
    const list = ['today'] as const;
    const before = [...list];
    toggleFavorite([...list], 'radar');
    expect([...list]).toEqual(before);
  });
});

describe('favoriteLinks', () => {
  it('resolves pinned ids to their label and destination', () => {
    expect(favoriteLinks(['radar'])).toEqual([
      { id: 'radar', ...MENU_LINKS.radar },
    ]);
  });

  it('is empty when nothing is pinned', () => {
    expect(favoriteLinks([])).toEqual([]);
  });
});
