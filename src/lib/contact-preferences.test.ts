import { describe, it, expect } from 'vitest';
import {
  effectiveMaxBudget,
  effectiveAreas,
  effectiveCategories,
} from './contact-preferences';

describe('effectiveMaxBudget', () => {
  it('prefers the explicit field over the AI extraction', () => {
    expect(
      effectiveMaxBudget({ max_budget: 25000000, pref_budget_max: 30000000 }),
    ).toEqual({ value: 25000000, source: 'explicit' });
  });

  it('falls back to the AI-extracted budget ("Budget within 3 cr")', () => {
    expect(effectiveMaxBudget({ pref_budget_max: 30000000 })).toEqual({
      value: 30000000,
      source: 'ai',
    });
  });

  it('coerces numeric strings (PostgREST returns NUMERIC as string)', () => {
    expect(effectiveMaxBudget({ pref_budget_max: '30000000' })).toEqual({
      value: 30000000,
      source: 'ai',
    });
  });

  it('ignores zero / invalid values and returns null when nothing usable', () => {
    expect(effectiveMaxBudget({ max_budget: 0, pref_budget_max: null })).toBeNull();
    expect(effectiveMaxBudget({})).toBeNull();
  });
});

describe('effectiveAreas', () => {
  it('prefers explicit areas', () => {
    expect(
      effectiveAreas({ areas_of_interest: ['HSR Layout'], pref_areas: ['Devanahalli'] }),
    ).toEqual({ value: ['HSR Layout'], source: 'explicit' });
  });

  it('falls back to AI-extracted areas', () => {
    expect(effectiveAreas({ areas_of_interest: [], pref_areas: ['Devanahalli'] })).toEqual({
      value: ['Devanahalli'],
      source: 'ai',
    });
  });

  it('treats whitespace-only entries as empty', () => {
    expect(effectiveAreas({ areas_of_interest: ['  '], pref_areas: null })).toBeNull();
  });
});

describe('effectiveCategories', () => {
  it('prefers explicit property interests', () => {
    expect(
      effectiveCategories({
        property_interests: ['Residential'],
        pref_property_categories: ['commercial'],
      }),
    ).toEqual({ value: ['Residential'], source: 'explicit' });
  });

  it('unions AI categories and types, capitalized and deduped', () => {
    expect(
      effectiveCategories({
        pref_property_categories: ['residential'],
        pref_property_types: ['Residential House', 'Flat/ Apartment'],
      }),
    ).toEqual({
      value: ['Residential', 'Residential House', 'Flat/ Apartment'],
      source: 'ai',
    });
  });

  it('returns null when nothing is known', () => {
    expect(effectiveCategories({})).toBeNull();
  });
});
