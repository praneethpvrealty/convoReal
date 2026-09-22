import { describe, expect, it } from 'vitest';

import {
  areaFilterVariants,
  areaOptionLabel,
  areaOverlapFilter,
  areaSearchTerms,
  areaSearchVariants,
  areasMatchSearch,
  areaVariantKey,
  groupAreaVariants,
  MAX_AREA_FILTER_VARIANTS,
  MAX_SELECTED_AREAS,
} from './area-variants';

describe('areaVariantKey', () => {
  it('[CTM-007] gives every spelling of a locality the same key', () => {
    const same = (...spellings: string[]) => {
      const keys = new Set(spellings.map(areaVariantKey));
      expect(keys.size, spellings.join(' / ')).toBe(1);
    };
    same('Brookefield', 'Brookfield', 'brookefield', 'Brookefield, Bengaluru');
    same(
      'AECS Layout',
      'aecs layout',
      'AECS Layout Bangalore',
      'A.E.C.S Layout'
    );
    same('Marathahalli', 'Marathalli', 'Marathahali');
    same('Whitefield', 'White Field', 'Whitefield, Bangalore');
    same(
      'Sarjapur Road',
      'Sarjapura Road',
      'Sarjapur  Rd'.replace('Rd', 'Road')
    );
    same('Electronic City', 'Electronics City');
    same('Koramangala', 'Kormangala');
    same('Indiranagar', 'Indira Nagar');
    same('Yelahanka', 'Yelhanka');
    same('Bellandur', 'Belandur');
  });

  it('[CTM-007] keeps different localities apart', () => {
    const keys = [
      'HSR Layout',
      'BTM Layout',
      'Koramangala',
      'Jayanagar',
      'JP Nagar',
      'Hebbal',
      'Hoodi',
      'Kengeri',
      'Kanakapura Road',
      'Whitefield',
      'Brookefield',
      'AECS Layout',
      'Domlur',
      'Bangalore North',
      'HSR',
      'Hosur',
      'Hosur Road',
      'Hennur',
      'Hanur',
    ].map(areaVariantKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('falls back to the cleaned text when nothing alphanumeric is left', () => {
    expect(areaVariantKey('  ')).toBe('');
    expect(areaVariantKey('Bengaluru')).toBe('benglr');
  });
});

describe('groupAreaVariants', () => {
  const rows = [
    { area: 'Brookfield', count: 2 },
    { area: 'Brookefield', count: 5 },
    { area: 'brookefield ', count: 1 },
    { area: 'AECS Layout', count: 3 },
    { area: 'aecs layout', count: 3 },
    { area: '', count: 9 },
  ];

  it('[CTM-007] merges spellings under the most common one and sums the counts', () => {
    expect(groupAreaVariants(rows)).toEqual([
      {
        key: areaVariantKey('AECS Layout'),
        label: 'AECS Layout',
        variants: ['AECS Layout', 'aecs layout'],
        count: 6,
      },
      {
        key: areaVariantKey('Brookefield'),
        label: 'Brookefield',
        variants: ['Brookefield', 'Brookfield', 'brookefield'],
        count: 8,
      },
    ]);
  });

  it('labels a group with its spelling count', () => {
    const [aecs, brookefield] = groupAreaVariants(rows);
    expect(areaOptionLabel(aecs)).toBe('AECS Layout (2 spellings)');
    expect(areaOptionLabel(brookefield)).toBe('Brookefield (3 spellings)');
    expect(areaOptionLabel({ ...aecs, variants: ['AECS Layout'] })).toBe(
      'AECS Layout'
    );
  });
});

describe('areaFilterVariants + areaOverlapFilter', () => {
  const options = groupAreaVariants([
    { area: 'Brookefield', count: 1 },
    { area: 'Brookfield', count: 1 },
    { area: 'AECS Layout', count: 1 },
    { area: 'Whitefield', count: 1 },
  ]);

  it('[CTM-007] expands every selected group to all of its spellings', () => {
    const keys = [areaVariantKey('Brookefield'), areaVariantKey('AECS Layout')];
    expect(areaFilterVariants(keys, options)).toEqual([
      'AECS Layout',
      'Brookefield',
      'Brookfield',
    ]);
    expect(areaFilterVariants(['missing'], options)).toEqual([]);
  });

  it('[CTM-007] bounds what one list request may carry', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      key: `k${i}`,
      label: `Area ${i}`,
      variants: [`Area ${i}`, `area ${i}`],
      count: 1,
    }));
    const keys = many.map((option) => option.key);
    const variants = areaFilterVariants(keys, many);
    expect(variants.length).toBeLessThanOrEqual(MAX_AREA_FILTER_VARIANTS);
    expect(variants).toEqual(
      areaFilterVariants(keys.slice(0, MAX_SELECTED_AREAS), many)
    );
  });

  it('[CTM-008] expands a typed locality to every stored spelling of it', () => {
    expect(areaSearchVariants('brookfield', options)).toEqual([
      'Brookefield',
      'Brookfield',
    ]);
    expect(areaSearchVariants('Brookefield, Bengaluru', options)).toEqual([
      'Brookefield',
      'Brookfield',
    ]);
    expect(areaSearchVariants('aecs layout', options)).toEqual(['AECS Layout']);
    expect(areaSearchVariants('Praneeth', options)).toEqual([]);
    expect(areaSearchVariants('   ', options)).toEqual([]);
  });

  it('[CTM-008] reads the locality out of a phrase, on any surface', () => {
    expect(areaSearchTerms('buyers in Brookfield')).toEqual([
      'buyers in Brookfield',
      'Brookfield',
    ]);
    expect(areaSearchTerms('2 bhk near AECS Layout for 1 cr')).toEqual([
      '2 bhk near AECS Layout for 1 cr',
      'AECS Layout',
    ]);
    expect(areaSearchTerms('in Whitefield, Bangalore')).toEqual([
      'in Whitefield, Bangalore',
      'Whitefield',
    ]);
    expect(areaSearchTerms('Praneeth')).toEqual(['Praneeth']);
    for (const phrase of [
      'buyers in Brookfield',
      'at brookefield',
      'near Brookfield for 2 cr',
      'around AECS Layout',
    ]) {
      expect(areaSearchVariants(phrase, options), phrase).not.toEqual([]);
    }
    expect(areaSearchVariants('buyers in Hosur', options)).toEqual([]);
  });

  it('[CTM-008] matches a loaded contact by area the same way', () => {
    const areas = ['Brookefield', 'HSR Layout'];
    expect(areasMatchSearch('brookfield', areas)).toBe(true);
    expect(areasMatchSearch('buyers in Brookfield', areas)).toBe(true);
    expect(areasMatchSearch('near hsr layout for 2 cr', areas)).toBe(true);
    expect(areasMatchSearch('Hosur', areas)).toBe(false);
    expect(areasMatchSearch('Praneeth', areas)).toBe(false);
    expect(areasMatchSearch('   ', areas)).toBe(false);
    expect(areasMatchSearch('Brookefield', [])).toBe(false);
  });

  it('[CTM-007] builds one overlap clause per column for a PostgREST or()', () => {
    expect(
      areaOverlapFilter(
        ['areas_of_interest', 'pref_areas'],
        ['AECS Layout', 'Brookefield']
      )
    ).toBe(
      'areas_of_interest.ov.{"AECS Layout","Brookefield"},pref_areas.ov.{"AECS Layout","Brookefield"}'
    );
  });

  it('escapes quotes and drops braces so a stored value cannot break the clause', () => {
    expect(areaOverlapFilter(['pref_areas'], ['Say "hi" {now}', ' '])).toBe(
      'pref_areas.ov.{"Say \\"hi\\" now"}'
    );
  });
});
