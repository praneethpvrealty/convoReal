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
    expect(isMenuRouteId('focus')).toBe(true);
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
    expect(normalizeFavorites(['radar', 'focus'])).toEqual(['radar', 'focus']);
  });

  it('drops ids this build no longer knows', () => {
    expect(normalizeFavorites(['focus', 'retired-screen'])).toEqual(['focus']);
  });

  it('dedupes repeats', () => {
    expect(normalizeFavorites(['focus', 'focus', 'deals'])).toEqual([
      'focus',
      'deals',
    ]);
  });

  it('falls back to empty for non-arrays — favourites have no default', () => {
    expect(normalizeFavorites(null)).toEqual([]);
    expect(normalizeFavorites(undefined)).toEqual([]);
    expect(normalizeFavorites('focus')).toEqual([]);
    expect(normalizeFavorites({ ids: ['focus'] })).toEqual([]);
  });
});

describe('toggleFavorite', () => {
  it('appends a new pin at the end', () => {
    expect(toggleFavorite(['focus'], 'radar')).toEqual(['focus', 'radar']);
  });

  it('removes an existing pin without disturbing the rest', () => {
    expect(toggleFavorite(['focus', 'radar', 'deals'], 'radar')).toEqual([
      'focus',
      'deals',
    ]);
  });

  it('does not mutate the list it was given', () => {
    const list = ['focus'] as const;
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
