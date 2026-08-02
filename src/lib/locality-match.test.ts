import { describe, expect, it } from 'vitest';
import {
  localityStems,
  localityStemProbe,
  rowMatchesLocality,
  textContainsLocality,
} from './locality-match';

describe('localityStems', () => {
  it('splits fused nagar suffixes', () => {
    expect(localityStems('Suryanagar')).toEqual(['surya']);
    expect(localityStems('Vijayanagara')).toEqual(['vijaya']);
  });

  it('drops generic designator tokens', () => {
    expect(localityStems('Surya City')).toEqual(['surya']);
    expect(localityStems('HSR Layout')).toEqual(['hsr']);
    expect(localityStems('Bommasandra Industrial Area')).toEqual(['bommasandra']);
  });

  it('keeps short names whole instead of over-stripping', () => {
    // remainder "sri" would be too short — "Srinagar" is its own place
    expect(localityStems('Srinagar')).toEqual(['srinagar']);
  });

  it('folds trailing plural s', () => {
    expect(localityStems('Electronics City')).toEqual(['electronic']);
  });
});

describe('textContainsLocality', () => {
  it('keeps plain substring matches', () => {
    expect(textContainsLocality('Bommasandra Industrial Area, Karnataka', 'Bommasandra')).toBe(true);
  });

  it('matches Suryanagar against a Surya City address', () => {
    expect(textContainsLocality('Surya City Layout, Chandapura', 'Suryanagar')).toBe(true);
  });

  it('matches Surya City against a Suryanagar address', () => {
    expect(textContainsLocality('Suryanagar, Anekal Taluk', 'Surya City')).toBe(true);
  });

  it('matches Electronic City against Electronics City Phase 1', () => {
    expect(textContainsLocality('Neeladri Road, Electronics City Phase 1', 'Electronic City')).toBe(true);
  });

  it('does not equate different localities sharing a designator', () => {
    expect(textContainsLocality('Surya City Layout', 'Electronic City')).toBe(false);
    expect(textContainsLocality('BTM Layout', 'HSR Layout')).toBe(false);
  });

  it('requires every stem of the label to be present', () => {
    expect(textContainsLocality('Sarjapur Main Road', 'Sarjapur Attibele Road')).toBe(false);
  });

  it('is false for empty labels', () => {
    expect(textContainsLocality('Surya City Layout', '')).toBe(false);
  });

  it('keeps substring behavior for designator-only labels', () => {
    expect(textContainsLocality('Surya City Layout', 'Layout')).toBe(true);
    expect(textContainsLocality('Surya Enclave', 'Layout')).toBe(false);
  });
});

describe('localityStemProbe', () => {
  it('returns the stem when it differs from the label', () => {
    expect(localityStemProbe('Suryanagar')).toBe('surya');
    expect(localityStemProbe('Electronic City')).toBe('electronic');
    expect(localityStemProbe('Surya City')).toBe('surya');
  });

  it('returns null when the label is already its own stem', () => {
    expect(localityStemProbe('Whitefield')).toBeNull();
  });

  it('returns null for short or multi-stem labels', () => {
    expect(localityStemProbe('HSR Layout')).toBeNull(); // stem "hsr" too short
    expect(localityStemProbe('Sarjapur Attibele Road')).toBeNull();
  });
});

describe('rowMatchesLocality', () => {
  // PROP-1108: the area is named only in the title, while `location`
  // holds a street address that resolves to a same-named colony in
  // another part of the city.
  const koramangalaRow = {
    title: 'Residential House in Koramangala 7th phase, opposite to the park',
    location: 'Plot 27, 20th Main, Phase VIII, KHB Colony, Bangalore, Karnataka',
    sublocality: 'KHB Colony',
    locality_canonical: null,
    project: null,
  };

  it('matches a locality named only in the title', () => {
    expect(rowMatchesLocality(koramangalaRow, 'Koramangala')).toBe(true);
  });

  it('still matches on the other locality fields', () => {
    expect(rowMatchesLocality({ sublocality: 'HSR Layout' }, 'HSR Layout')).toBe(true);
    expect(rowMatchesLocality({ location: 'Surya City, Chandapura' }, 'Suryanagar')).toBe(true);
    expect(rowMatchesLocality({ project: 'Prestige Falcon City' }, 'Falcon City')).toBe(true);
  });

  it('does not match an unrelated locality', () => {
    expect(rowMatchesLocality(koramangalaRow, 'Whitefield')).toBe(false);
    expect(rowMatchesLocality({ title: null, location: null }, 'Koramangala')).toBe(false);
  });
});
