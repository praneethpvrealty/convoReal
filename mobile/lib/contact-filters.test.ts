import { describe, it, expect } from 'vitest';

import {
  activeFilterCount,
  EMPTY_FILTERS,
  filtersKey,
  isDirty,
  sortColumn,
  type ContactFilters,
} from './contact-filters';

const withFilters = (patch: Partial<ContactFilters>): ContactFilters => ({
  ...EMPTY_FILTERS,
  ...patch,
});

describe('activeFilterCount', () => {
  it('is zero for the defaults', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it('counts each narrowing filter', () => {
    expect(
      activeFilterCount(
        withFilters({ classification: 'Buyer', area: 'HSR Layout' })
      )
    ).toBe(2);
    expect(
      activeFilterCount(withFilters({ minBudget: 5000000, maxBudget: 10000000 }))
    ).toBe(2);
  });

  it('ignores sort, which orders rather than narrows', () => {
    expect(activeFilterCount(withFilters({ sort: 'name_asc' }))).toBe(0);
  });

  it('counts a zero budget bound rather than treating it as unset', () => {
    expect(activeFilterCount(withFilters({ minBudget: 0 }))).toBe(1);
  });
});

describe('isDirty', () => {
  it('is false only at the defaults', () => {
    expect(isDirty(EMPTY_FILTERS)).toBe(false);
  });

  it('is true for a filter or a non-default sort', () => {
    expect(isDirty(withFilters({ tagId: 'abc' }))).toBe(true);
    expect(isDirty(withFilters({ sort: 'max_budget_desc' }))).toBe(true);
  });
});

describe('sortColumn', () => {
  it('maps each key to its column and direction', () => {
    expect(sortColumn('created_desc')).toEqual({
      column: 'created_at',
      ascending: false,
    });
    expect(sortColumn('name_asc')).toEqual({ column: 'name', ascending: true });
    expect(sortColumn('name_desc')).toEqual({
      column: 'name',
      ascending: false,
    });
    expect(sortColumn('last_contacted_desc')).toEqual({
      column: 'last_contacted_at',
      ascending: false,
    });
    expect(sortColumn('max_budget_desc')).toEqual({
      column: 'max_budget',
      ascending: false,
    });
    expect(sortColumn('max_budget_asc')).toEqual({
      column: 'max_budget',
      ascending: true,
    });
  });
});

describe('filtersKey', () => {
  it('separates filter sets that differ in one field', () => {
    expect(filtersKey(withFilters({ classification: 'Buyer' }))).not.toBe(
      filtersKey(withFilters({ classification: 'Seller' }))
    );
    expect(filtersKey(withFilters({ sort: 'name_asc' }))).not.toBe(
      filtersKey(EMPTY_FILTERS)
    );
  });

  it('is stable for equal filter sets', () => {
    expect(filtersKey(withFilters({ area: 'Whitefield' }))).toBe(
      filtersKey(withFilters({ area: 'Whitefield' }))
    );
  });

  it('does not confuse an unset bound with a zero one', () => {
    expect(filtersKey(withFilters({ minBudget: 0 }))).not.toBe(
      filtersKey(EMPTY_FILTERS)
    );
  });
});
