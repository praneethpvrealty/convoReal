import { describe, expect, it } from 'vitest';
import {
  dispositionFor,
  fieldPolicy,
  formatValue,
  learnableFields,
  normalizeValue,
  valuesDiffer,
} from './fields';

describe('field policy registry', () => {
  it('reviews a seller price and applies a buyer preference', () => {
    // The split that justifies the registry: a commercial fact waits
    // for a human, a buyer's own words do not — the ladder reads them
    // back on the very next message.
    expect(dispositionFor('property', 'seller_final_price')).toBe('propose');
    expect(dispositionFor('property', 'seller_final_price_per_sqft')).toBe(
      'propose'
    );
    expect(dispositionFor('contact', 'pref_budget_max')).toBe('auto');
    expect(dispositionFor('contact', 'pref_areas')).toBe('auto');
  });

  it('knows nothing about a field no learner may write', () => {
    expect(dispositionFor('property', 'is_published')).toBeNull();
    expect(dispositionFor('property', 'account_id')).toBeNull();
    expect(dispositionFor('contact', 'phone')).toBeNull();
    // Entity is part of the key: a property has no pref_budget_max.
    expect(dispositionFor('property', 'pref_budget_max')).toBeNull();
  });

  it('lists the fields each entity exposes', () => {
    expect(learnableFields('property')).toEqual([
      'seller_final_price',
      'seller_final_price_per_sqft',
    ]);
    expect(learnableFields('contact')).toContain('pref_budget_min');
  });
});

describe('normalizeValue', () => {
  const rate = fieldPolicy('property', 'seller_final_price_per_sqft')!;
  const budget = fieldPolicy('contact', 'pref_budget_max')!;
  const areas = fieldPolicy('contact', 'pref_areas')!;

  it('rejects a rate the model failed to scale', () => {
    // "10.5k per sqft" read as 10.5 would be a rate of ten rupees.
    expect(normalizeValue(rate, 10.5)).toBeNull();
    expect(normalizeValue(rate, 10500)).toBe(10500);
  });

  it('rejects a budget below what any property costs', () => {
    expect(normalizeValue(budget, 2)).toBeNull();
    expect(normalizeValue(budget, 20_000_000)).toBe(20_000_000);
  });

  it('coerces numeric strings and rounds', () => {
    expect(normalizeValue(rate, '10500.4')).toBe(10500);
  });

  it('treats a null or unparseable value as nothing learned', () => {
    expect(normalizeValue(rate, null)).toBeNull();
    expect(normalizeValue(rate, 'call for price')).toBeNull();
    expect(normalizeValue(rate, '')).toBeNull();
  });

  it('cleans a list and dedupes case-insensitively, keeping what was written', () => {
    expect(normalizeValue(areas, ['HSR Layout', ' hsr layout ', 'Koramangala'])).toEqual([
      'HSR Layout',
      'Koramangala',
    ]);
  });

  it('refuses a non-list for a list field', () => {
    expect(normalizeValue(areas, 'HSR Layout')).toBeNull();
  });
});

describe('valuesDiffer', () => {
  it('ignores ordering and casing in a list', () => {
    // A re-extraction that reshuffled the same areas is not a change
    // worth an audit row.
    expect(valuesDiffer(['HSR', 'Koramangala'], ['koramangala', 'hsr'])).toBe(
      false
    );
    expect(valuesDiffer(['HSR'], ['HSR', 'Koramangala'])).toBe(true);
  });

  it('sees a first value arriving', () => {
    expect(valuesDiffer(null, 10500)).toBe(true);
    expect(valuesDiffer(undefined, ['HSR'])).toBe(true);
  });

  it('compares numbers numerically, not textually', () => {
    expect(valuesDiffer('10500', 10500)).toBe(false);
    expect(valuesDiffer(10500, 11000)).toBe(true);
  });

  it('is false when nothing moved', () => {
    expect(valuesDiffer(null, null)).toBe(false);
  });
});

describe('formatValue', () => {
  it('renders each kind the way an agent reads it', () => {
    expect(
      formatValue(fieldPolicy('property', 'seller_final_price')!, 44_100_000)
    ).toBe('₹4,41,00,000');
    expect(
      formatValue(fieldPolicy('property', 'seller_final_price_per_sqft')!, 10500)
    ).toBe('₹10,500/sq.ft.');
    expect(formatValue(fieldPolicy('contact', 'pref_areas')!, ['HSR', 'BTM'])).toBe(
      'HSR, BTM'
    );
    expect(formatValue(fieldPolicy('contact', 'pref_bhk_min')!, 3)).toBe('3');
  });

  it('shows an empty value as a dash rather than blank', () => {
    expect(formatValue(fieldPolicy('contact', 'pref_areas')!, [])).toBe('—');
    expect(formatValue(fieldPolicy('contact', 'pref_budget_max')!, null)).toBe('—');
  });
});

describe('tags as a learnable field', () => {
  it('proposes rather than attaches — the taxonomy is shared', () => {
    // An auto-attached "Investor" that should have been "Investors" is
    // a duplicate every agent then works around.
    expect(dispositionFor('contact', 'tags')).toBe('propose');
    expect(fieldPolicy('contact', 'tags')!.applyAs).toBe('contact_tags');
  });

  it('keeps the suggestion column itself automatic', () => {
    // Writing pref_suggested_tags attaches nothing and changes no
    // matching, so it applies on sight like the rest of the extraction.
    expect(dispositionFor('contact', 'pref_suggested_tags')).toBe('auto');
    expect(fieldPolicy('contact', 'pref_suggested_tags')!.applyAs).toBeUndefined();
  });

  it('renders a yield as a percentage', () => {
    expect(formatValue(fieldPolicy('contact', 'pref_min_roi')!, 4)).toBe('4%');
  });
});
