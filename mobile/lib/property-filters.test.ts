import { describe, it, expect } from 'vitest';

import {
  activePropertyFilterCount,
  applyPropertyFilterParams,
  EMPTY_PROPERTY_FILTERS,
  isPropertyFiltersDirty,
  propertyFiltersKey,
  PROPERTY_SORTS,
  statusParam,
  type PropertyFilters,
} from './property-filters';

const withFilters = (patch: Partial<PropertyFilters>): PropertyFilters => ({
  ...EMPTY_PROPERTY_FILTERS,
  ...patch,
});

/** The params `applyPropertyFilterParams` produced, as a plain object. */
function applied(filters: PropertyFilters, hasNear = false) {
  return Object.fromEntries(
    applyPropertyFilterParams(new URLSearchParams(), filters, hasNear)
  );
}

describe('activePropertyFilterCount', () => {
  it('is zero for the defaults', () => {
    expect(activePropertyFilterCount(EMPTY_PROPERTY_FILTERS)).toBe(0);
  });

  it('counts each narrowing filter', () => {
    expect(
      activePropertyFilterCount(
        withFilters({ type: 'Residential', status: 'Sold', source: 'owner' })
      )
    ).toBe(3);
  });

  it('ignores sort, which orders rather than narrows', () => {
    expect(activePropertyFilterCount(withFilters({ sort: 'price_asc' }))).toBe(
      0
    );
  });

  it('counts a zero price bound rather than treating it as unset', () => {
    expect(activePropertyFilterCount(withFilters({ minPrice: 0 }))).toBe(1);
  });
});

describe('isPropertyFiltersDirty', () => {
  it('is false only at the defaults', () => {
    expect(isPropertyFiltersDirty(EMPTY_PROPERTY_FILTERS)).toBe(false);
  });

  it('is true for a filter or a non-default sort', () => {
    expect(isPropertyFiltersDirty(withFilters({ showcase: 'true' }))).toBe(
      true
    );
    expect(isPropertyFiltersDirty(withFilters({ sort: 'title_asc' }))).toBe(
      true
    );
  });
});

describe('statusParam', () => {
  it('asks for Available when nothing widens it', () => {
    expect(statusParam(EMPTY_PROPERTY_FILTERS, false)).toEqual([
      'status',
      'Available',
    ]);
  });

  it('drops to exclude_archived when the chip widens it', () => {
    expect(statusParam(EMPTY_PROPERTY_FILTERS, true)).toEqual([
      'exclude_archived',
      'true',
    ]);
  });

  it('lets an explicit status win over the chip, never sending both', () => {
    // The route throws on status + exclude_archived together, so this
    // has to stay an either/or.
    expect(statusParam(withFilters({ status: 'Sold' }), true)).toEqual([
      'status',
      'Sold',
    ]);
    expect(statusParam(withFilters({ status: 'Sold' }), false)).toEqual([
      'status',
      'Sold',
    ]);
  });
});

describe('applyPropertyFilterParams', () => {
  it('writes nothing for the defaults', () => {
    expect(applied(EMPTY_PROPERTY_FILTERS)).toEqual({});
  });

  it('maps each filter onto the route’s param name', () => {
    expect(
      applied(
        withFilters({
          type: 'Commercial',
          source: 'agent',
          showcase: 'false',
          minPrice: 5000000,
          maxPrice: 20000000,
        })
      )
    ).toEqual({
      type: 'Commercial',
      listing_source: 'agent',
      is_published: 'false',
      min_price: '5000000',
      max_price: '20000000',
    });
  });

  it('never writes status — statusParam owns that decision', () => {
    expect(applied(withFilters({ status: 'Sold' }))).toEqual({});
  });

  it('sends sort and order together for a non-default sort', () => {
    expect(applied(withFilters({ sort: 'price_asc' }))).toEqual({
      sort: 'price',
      order: 'asc',
    });
    expect(applied(withFilters({ sort: 'updated' }))).toEqual({
      sort: 'updated_at',
      order: 'desc',
    });
  });

  it('omits the sort under a location anchor, which the route ignores', () => {
    expect(applied(withFilters({ sort: 'price_desc' }), true)).toEqual({});
    // …but the narrowing filters still travel.
    expect(applied(withFilters({ type: 'Residential' }), true)).toEqual({
      type: 'Residential',
    });
  });

  it('keeps a zero price bound instead of dropping it as falsy', () => {
    expect(applied(withFilters({ minPrice: 0 }))).toEqual({ min_price: '0' });
  });
});

describe('PROPERTY_SORTS', () => {
  it('only names fields the route allows to sort', () => {
    // ALLOWED_SORT_FIELDS in src/app/api/properties/route.ts — anything
    // outside it is silently replaced with created_at.
    const allowed = [
      'created_at',
      'updated_at',
      'title',
      'price',
      'location',
      'status',
      'is_published',
    ];
    for (const sort of PROPERTY_SORTS) {
      expect(allowed, `${sort.key} → ${sort.field}`).toContain(sort.field);
    }
  });
});

describe('propertyFiltersKey', () => {
  it('separates filter sets that differ in one field', () => {
    expect(propertyFiltersKey(withFilters({ type: 'Villa' }))).not.toBe(
      propertyFiltersKey(withFilters({ type: 'Penthouse' }))
    );
    expect(propertyFiltersKey(withFilters({ sort: 'price_asc' }))).not.toBe(
      propertyFiltersKey(EMPTY_PROPERTY_FILTERS)
    );
  });

  it('does not confuse an unset bound with a zero one', () => {
    expect(propertyFiltersKey(withFilters({ minPrice: 0 }))).not.toBe(
      propertyFiltersKey(EMPTY_PROPERTY_FILTERS)
    );
  });
});
