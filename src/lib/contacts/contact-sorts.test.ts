import { describe, expect, it } from 'vitest';
import {
  CONTACT_SORTS,
  activeContactFilterCount,
  contactListCacheKey,
  contactSortItems,
  contactSortLabel,
} from './contact-sorts';

const NONE = {
  classification: 'All',
  tag: 'All',
  minBudget: 'All',
  maxBudget: 'All',
  areas: [],
  interestProperty: 'All',
  interestProject: 'All',
};

describe('contact sorts', () => {
  it('offers the same orders and labels as the mobile filter sheet', () => {
    expect(CONTACT_SORTS.map((s) => `${s.value}:${s.label}`)).toEqual([
      'created_desc:Newest',
      'updated_desc:Recently modified',
      'name_asc:Name A–Z',
      'name_desc:Name Z–A',
      'last_contacted_desc:Last contacted',
      'max_budget_desc:Budget high',
      'max_budget_asc:Budget low',
    ]);
  });

  it('names a column-only sort so the trigger never shows a raw key', () => {
    expect(contactSortLabel('last_contacted_asc')).toBe(
      'Least recently contacted'
    );
    expect(contactSortLabel('nope')).toBe('Newest');
    expect(contactSortItems('last_contacted_asc').at(-1)).toEqual({
      value: 'last_contacted_asc',
      label: 'Least recently contacted',
    });
    expect(contactSortItems('name_asc')).toHaveLength(7);
  });

  it('counts the interest filters as active filters', () => {
    expect(activeContactFilterCount(NONE)).toBe(0);
    expect(
      activeContactFilterCount({
        ...NONE,
        interestProperty: 'prop-1',
        interestProject: 'Prestige Lakeside',
        tag: 'tag-1',
      })
    ).toBe(3);
  });

  it('[CTM-007] counts any number of selected areas as one filter', () => {
    expect(activeContactFilterCount({ ...NONE, areas: ['brkfld'] })).toBe(1);
    expect(
      activeContactFilterCount({ ...NONE, areas: ['brkfld', 'acslyt'] })
    ).toBe(1);
  });

  it('[CTM-007] keys the cache on the selected areas', () => {
    const key = (areas: string[]) =>
      contactListCacheKey(
        'acct',
        0,
        'active',
        'created_desc',
        { ...NONE, areas },
        ''
      );
    expect(key([])).not.toBe(key(['brkfld']));
    expect(key(['brkfld'])).not.toBe(key(['brkfld', 'acslyt']));
  });

  it('keys the cache on the project filter too', () => {
    const a = contactListCacheKey(
      'acct',
      0,
      'active',
      'created_desc',
      NONE,
      ''
    );
    const b = contactListCacheKey(
      'acct',
      0,
      'active',
      'created_desc',
      { ...NONE, interestProject: 'Prestige Lakeside' },
      ''
    );
    expect(a).not.toBe(b);
  });
});
