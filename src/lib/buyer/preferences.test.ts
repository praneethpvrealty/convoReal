import { describe, it, expect } from 'vitest';

import {
  parseBuyerPreferenceBody,
  BUYER_PROPERTY_INTEREST_OPTIONS,
} from './preferences';

describe('parseBuyerPreferenceBody', () => {
  it('parses a full valid body', () => {
    const update = parseBuyerPreferenceBody({
      min_budget: 5000000,
      max_budget: '2,00,00,000',
      areas_of_interest: ['JP Nagar', ' Jayanagar '],
      property_interests: ['Vacant plot'],
      min_roi: 4.5,
    });
    expect(update).toEqual({
      min_budget: 5000000,
      max_budget: 20000000,
      areas_of_interest: ['JP Nagar', 'Jayanagar'],
      property_interests: ['Vacant plot'],
      min_roi: 4.5,
    });
  });

  it('treats null/empty numerics as clearing and missing keys as leave-as-is', () => {
    const update = parseBuyerPreferenceBody({
      min_budget: null,
      max_budget: '',
    });
    expect(update.min_budget).toBeNull();
    expect(update.max_budget).toBeNull();
    expect(update).not.toHaveProperty('min_roi');
    expect(update).not.toHaveProperty('areas_of_interest');
  });

  it('drops junk values instead of writing them', () => {
    const update = parseBuyerPreferenceBody({
      min_budget: 'abc',
      max_budget: -5,
      min_roi: Infinity,
      areas_of_interest: 'not an array',
      property_interests: [42, 'Space station'],
    });
    expect(update).not.toHaveProperty('min_budget');
    expect(update).not.toHaveProperty('max_budget');
    expect(update).not.toHaveProperty('min_roi');
    expect(update).not.toHaveProperty('areas_of_interest');
    expect(update.property_interests).toEqual([]);
  });

  it('filters property interests to the shared vocabulary', () => {
    const update = parseBuyerPreferenceBody({
      property_interests: [...BUYER_PROPERTY_INTEREST_OPTIONS, 'Castle'],
    });
    expect(update.property_interests).toEqual(BUYER_PROPERTY_INTEREST_OPTIONS);
  });

  it('caps runaway area lists and empty bodies', () => {
    const update = parseBuyerPreferenceBody({
      areas_of_interest: Array.from({ length: 40 }, (_, i) => `Area ${i}`),
    });
    expect(update.areas_of_interest).toHaveLength(25);
    expect(parseBuyerPreferenceBody(null)).toEqual({});
  });
});
