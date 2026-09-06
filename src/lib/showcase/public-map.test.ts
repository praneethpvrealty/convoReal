import { describe, expect, it } from 'vitest';
import type { Property } from '@/types';
import { publicMapProperties } from './public-map';

const property = { id: 'home', latitude: 12.97, longitude: 77.59 } as Property;
describe('public showcase map', () => {
  it('excludes guarded and teaser listings even if coordinates are present', () => {
    expect(
      publicMapProperties([
        {
          ...property,
          id: 'guarded',
          location_guarded: true,
          location_revealed: false,
        },
        { ...property, id: 'teaser', teaser_gated: true },
        { ...property, id: 'public' },
        {
          ...property,
          id: 'revealed',
          location_guarded: true,
          location_revealed: true,
        },
      ]).map((item) => item.id)
    ).toEqual(['public', 'revealed']);
  });
  it('does not plot missing or invalid coordinates', () => {
    expect(
      publicMapProperties([
        { id: 'empty' } as Property,
        { id: 'address-only', location: 'Whitefield, Bengaluru' } as Property,
        { ...property, latitude: 100 },
        { ...property, longitude: NaN },
      ])
    ).toEqual([]);
  });
});
