import { describe, expect, it } from 'vitest';

import {
  areaFilterVariants,
  areaOptionLabel,
  areaOverlapFilter,
  type AreaOption,
} from './contact-area-options';

const options: AreaOption[] = [
  {
    key: 'acslyt',
    label: 'AECS Layout',
    variants: ['AECS Layout', 'aecs layout'],
    count: 6,
  },
  {
    key: 'brkfld',
    label: 'Brookefield',
    variants: ['Brookefield', 'Brookfield'],
    count: 8,
  },
  { key: 'wtfld', label: 'Whitefield', variants: ['Whitefield'], count: 3 },
];

describe('areaFilterVariants', () => {
  it('[CTM-007] expands every selected group to all of its spellings', () => {
    expect(areaFilterVariants(['brkfld', 'acslyt'], options)).toEqual([
      'AECS Layout',
      'aecs layout',
      'Brookefield',
      'Brookfield',
    ]);
    expect(areaFilterVariants(['missing'], options)).toEqual([]);
    expect(areaFilterVariants([], options)).toEqual([]);
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
