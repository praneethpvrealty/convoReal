import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROPERTY_SORT,
  PROPERTY_SORTS,
  nextColumnSort,
  propertySortByKey,
  propertySortFor,
} from './property-sorts';

describe('property sorts', () => {
  it('offers the same orders as the mobile filter sheet', () => {
    expect(PROPERTY_SORTS.map((s) => `${s.field}:${s.order}`)).toEqual([
      'created_at:desc',
      'updated_at:desc',
      'price:desc',
      'price:asc',
      'title:asc',
    ]);
  });

  it('falls back to newest for an unknown key', () => {
    expect(propertySortByKey('nope')).toBe(DEFAULT_PROPERTY_SORT);
    expect(propertySortByKey('price_asc').field).toBe('price');
  });

  it('flips direction on the active column and starts a new one naturally', () => {
    const byPrice = nextColumnSort(DEFAULT_PROPERTY_SORT, 'price');
    expect(byPrice).toMatchObject({ field: 'price', order: 'desc' });
    expect(nextColumnSort(byPrice, 'price')).toMatchObject({
      field: 'price',
      order: 'asc',
    });
    expect(nextColumnSort(byPrice, 'title')).toMatchObject({
      field: 'title',
      order: 'asc',
    });
    expect(nextColumnSort(byPrice, 'status')).toMatchObject({
      field: 'status',
      order: 'asc',
    });
  });

  it('keeps a column sort the select does not list', () => {
    const sort = propertySortFor('location', 'desc');
    expect(sort).toMatchObject({ field: 'location', order: 'desc' });
    expect(sort.key).toBe('location_desc');
    expect(sort.label).toBe('Locality: Z–A');
    expect(propertySortFor('created_at', 'asc').label).toBe(
      'Added: oldest first'
    );
  });
});
