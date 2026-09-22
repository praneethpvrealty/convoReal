import { describe, expect, it } from 'vitest';

import {
  areaFilterVariants,
  areaOptionLabel,
  areaOverlapFilter,
  areaSearchTerms,
  areaSearchVariants,
  areasMatchSearch,
  areaVariantKey,
  MAX_AREA_FILTER_VARIANTS,
  MAX_SELECTED_AREAS,
  type AreaOption,
} from './contact-area-options';

const options: AreaOption[] = [
  {
    key: areaVariantKey('AECS Layout'),
    label: 'AECS Layout',
    variants: ['AECS Layout', 'aecs layout'],
    count: 6,
  },
  {
    key: areaVariantKey('Brookefield'),
    label: 'Brookefield',
    variants: ['Brookefield', 'Brookfield'],
    count: 8,
  },
  {
    key: areaVariantKey('Whitefield'),
    label: 'Whitefield',
    variants: ['Whitefield'],
    count: 3,
  },
];

describe('areaSearchVariants', () => {
  it('[CTM-008] expands a typed locality to every stored spelling of it', () => {
    expect(areaSearchVariants('brookfield', options)).toEqual([
      'Brookefield',
      'Brookfield',
    ]);
    expect(areaSearchVariants('Brookefield, Bengaluru', options)).toEqual([
      'Brookefield',
      'Brookfield',
    ]);
    expect(areaSearchVariants('Praneeth', options)).toEqual([]);
    expect(areaSearchVariants('   ', options)).toEqual([]);
  });

  it('[CTM-008] reads the locality out of a phrase', () => {
    expect(areaSearchTerms('buyers in Brookfield')).toEqual([
      'buyers in Brookfield',
      'Brookfield',
    ]);
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
});

describe('areasMatchSearch', () => {
  it('[REQ-003] matches a loaded brief by area, spellings merged', () => {
    const areas = ['Brookefield', 'HSR Layout'];
    expect(areasMatchSearch('brookfield', areas)).toBe(true);
    expect(areasMatchSearch('buyers in Brookfield', areas)).toBe(true);
    expect(areasMatchSearch('near hsr layout for 2 cr', areas)).toBe(true);
    expect(areasMatchSearch('Hosur', areas)).toBe(false);
    expect(areasMatchSearch('Praneeth', areas)).toBe(false);
    expect(areasMatchSearch('Brookefield', [])).toBe(false);
  });

  it('[REQ-003] matches a numbered locality after a preposition', () => {
    const areas = ['1st Block Jayanagar'];
    expect(areasMatchSearch('near 1st Block Jaya Nagar', areas)).toBe(true);
    expect(areasMatchSearch('near 2nd Block Jayanagar', areas)).toBe(false);
  });
});

describe('areaFilterVariants', () => {
  it('[CTM-007] expands every selected group to all of its spellings', () => {
    expect(
      areaFilterVariants(
        [areaVariantKey('Brookefield'), areaVariantKey('AECS Layout')],
        options
      )
    ).toEqual(['AECS Layout', 'aecs layout', 'Brookefield', 'Brookfield']);
    expect(areaFilterVariants(['missing'], options)).toEqual([]);
    expect(areaFilterVariants([], options)).toEqual([]);
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
});

describe('areaOverlapFilter', () => {
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

describe('areaOptionLabel', () => {
  it('names the spelling count only when there is more than one', () => {
    expect(areaOptionLabel(options[0])).toBe('AECS Layout (2 spellings)');
    expect(areaOptionLabel(options[2])).toBe('Whitefield');
  });
});
