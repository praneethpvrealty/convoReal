import { describe, expect, it } from 'vitest';

import {
  computeValuation,
  desiredClass,
  districtPattern,
  qualifiers,
  rankMatches,
  searchQueries,
  surveyNumbersCover,
  tokens,
} from './match';
import type { GuidanceRate, PropertySchedule } from './types';

const koramangala: PropertySchedule = {
  district: 'Bengaluru Urban',
  city: 'Bangalore',
  locality: 'Koramangala 6th Block',
  road: '18th Main',
  pincode: '560095',
  municipal_number: '436',
  pid: '67-8-436',
  kind: 'house',
  usage: 'residential',
  built_up_area: { value: 4319, unit: 'sqft' },
  floors: [
    { label: 'Ground', area: { value: 1916, unit: 'sqft' } },
    { label: 'First', area: { value: 2203, unit: 'sqft' } },
    { label: 'Second', area: { value: 200, unit: 'sqft' } },
  ],
};

function rate(overrides: Partial<GuidanceRate>): GuidanceRate {
  return {
    id: overrides.id ?? 'r',
    source_id: 's',
    district: 'Bengaluru Urban',
    taluk: null,
    hobli: null,
    village: null,
    locality: null,
    road: null,
    survey_numbers: null,
    property_class: 'residential_site',
    rate: 100000,
    unit: 'sqm',
    page: 1,
    source_title: 'Bengaluru Urban 2023',
    effective_from: '2023-10-01',
    ...overrides,
  };
}

describe('tokens / qualifiers', () => {
  it('normalises ordinals, roman numerals and road words', () => {
    expect(tokens('18th Main Road')).toEqual(['18', 'main']);
    expect(tokens('Koramangala VI Block')).toEqual([
      'koramangala',
      '6',
      'block',
    ]);
  });

  it('reads block and stage numbers on either side of the word', () => {
    expect(qualifiers('Koramangala 6th Block')).toEqual(
      new Map([['block', '6']])
    );
    expect(qualifiers('BTM Stage II')).toEqual(new Map([['stage', '2']]));
  });
});

describe('surveyNumbersCover', () => {
  it('matches listed numbers and ranges', () => {
    expect(surveyNumbersCover('12, 13, 45/2', '45/2')).toBe(true);
    expect(surveyNumbersCover('1 to 25', '17')).toBe(true);
    expect(surveyNumbersCover('30-40', '17')).toBe(false);
    expect(surveyNumbersCover(null, '17')).toBe(false);
  });

  it('[GVL-002] keeps subdivided survey numbers apart', () => {
    expect(surveyNumbersCover('45/1', '45/2')).toBe(false);
    expect(surveyNumbersCover('45 / 1, 46', '45/1')).toBe(true);
    expect(surveyNumbersCover('45', '45/2')).toBe(true);
    expect(surveyNumbersCover('45/2', '45/2/1')).toBe(true);
    expect(surveyNumbersCover('45/2', '45')).toBe(false);
    expect(surveyNumbersCover('45/1-3', '2')).toBe(false);
  });
});

describe('desiredClass', () => {
  it('maps kind and usage to the rate column', () => {
    expect(desiredClass(koramangala)).toBe('residential_site');
    expect(desiredClass({ kind: 'apartment' })).toBe('residential_apartment');
    expect(desiredClass({ kind: 'apartment', usage: 'commercial' })).toBe(
      'commercial_apartment'
    );
    expect(desiredClass({ land_area: { value: 2, unit: 'acre' } })).toBe(
      'agricultural'
    );
    expect(desiredClass({})).toBeNull();
  });
});

describe('computeValuation', () => {
  it('values a site on land area, converting sq.m rates to sq.ft', () => {
    const valuation = computeValuation(
      { land_area: { value: 100, unit: 'sqm' } },
      { rate: 50000, unit: 'sqm', property_class: 'residential_site' }
    );
    expect(valuation.basis).toBe('land');
    expect(valuation.total_value).toBe(5000000);
    expect(valuation.missing).toEqual([]);
  });

  it('[GVL-003] asks for the land extent when the schedule gives only built-up area', () => {
    const valuation = computeValuation(koramangala, {
      rate: 100000,
      unit: 'sqm',
      property_class: 'residential_site',
    });
    expect(valuation.total_value).toBeNull();
    expect(valuation.missing).toEqual(['land_area']);
  });

  it('adds the building component when a construction rate is given', () => {
    const valuation = computeValuation(
      koramangala,
      { rate: 10000, unit: 'sqft', property_class: 'residential_site' },
      { land_area_sqft: 2400, building_rate_per_sqft: 1500 }
    );
    expect(valuation.land_value).toBe(24000000);
    expect(valuation.building_value).toBe(4319 * 1500);
    expect(valuation.total_value).toBe(24000000 + 4319 * 1500);
  });

  it('[GVL-003] values an apartment on built-up area, summing floors when needed', () => {
    const valuation = computeValuation(
      { floors: koramangala.floors },
      { rate: 8000, unit: 'sqft', property_class: 'residential_apartment' }
    );
    expect(valuation.basis).toBe('built_up');
    expect(valuation.area_sqft).toBe(4319);
    expect(valuation.total_value).toBe(4319 * 8000);
  });

  it('converts guntas and acres', () => {
    const valuation = computeValuation(
      { land_area: { value: 1, unit: 'acre' } },
      { rate: 1000, unit: 'gunta', property_class: 'agricultural' }
    );
    expect(valuation.total_value).toBe(40000);
  });
});

describe('rankMatches', () => {
  const rates = [
    rate({ id: 'other-block', locality: 'Koramangala 5th Block' }),
    rate({ id: 'area-wide', locality: 'Koramangala 6th Block' }),
    rate({ id: 'road', locality: 'Koramangala 6th Block', road: '18th Main' }),
    rate({
      id: 'other-road',
      locality: 'Koramangala 6th Block',
      road: '80 Feet Road',
    }),
    rate({
      id: 'apartment',
      locality: 'Koramangala 6th Block',
      road: '18th Main',
      property_class: 'residential_apartment',
    }),
    rate({ id: 'elsewhere', locality: 'Jayanagar 4th Block' }),
  ];

  it('[GVL-002] puts the road-specific rate of the right block and class first', () => {
    const matches = rankMatches(koramangala, rates);
    expect(matches[0].rate.id).toBe('road');
    expect(matches.map((m) => m.rate.id)).not.toContain('elsewhere');
    const ids = matches.map((m) => m.rate.id);
    expect(ids.indexOf('area-wide')).toBeLessThan(ids.indexOf('other-block'));
    expect(ids.indexOf('road')).toBeLessThan(ids.indexOf('apartment'));
  });

  it('carries the valuation with each match', () => {
    const [best] = rankMatches(koramangala, rates, { land_area_sqft: 2400 });
    expect(best.valuation.total_value).toBeGreaterThan(0);
  });
});

describe('searchQueries / districtPattern', () => {
  it('searches by locality first, then village and city', () => {
    expect(searchQueries(koramangala)).toEqual([
      'koramangala 6 block',
      'bangalore',
    ]);
  });

  it('matches renamed district spellings', () => {
    const pattern = districtPattern(koramangala) ?? '';
    expect(new RegExp(pattern, 'i').test('Bangalore Urban')).toBe(true);
    expect(new RegExp(pattern, 'i').test('Bengaluru Urban')).toBe(true);
    expect(districtPattern({})).toBeNull();
  });
});
