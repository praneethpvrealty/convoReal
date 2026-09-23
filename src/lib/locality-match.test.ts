import { describe, expect, it } from 'vitest';
import {
  localityLabelsMatch,
  localityStems,
  localityStemProbe,
  normalizeLocalityLabel,
  rowMatchesBengaluruZone,
  rowMatchesLocality,
  textContainsLocality,
  textNamesLocality,
} from './locality-match';
import {
  canonicalBengaluruZone,
  extractBengaluruZones,
} from './bengaluru-zones';

describe('Bengaluru zones', () => {
  it('normalizes Bangalore and Bengaluru spellings', () => {
    expect(canonicalBengaluruZone('South Bangalore')).toBe('South Bengaluru');
    expect(canonicalBengaluruZone('north east Bengaluru zone')).toBe(
      'North-East Bengaluru'
    );
    expect(canonicalBengaluruZone('CBD')).toBe('CBD & Off-CBD');
    expect(canonicalBengaluruZone('Outer Ring Road')).toBe('ORR');
    expect(canonicalBengaluruZone('PBD East')).toBe('PBD East');
  });

  it('extracts zones from a longer requirement', () => {
    expect(
      extractBengaluruZones('Looking in South Bangalore or East Bengaluru')
    ).toEqual(['South Bengaluru', 'East Bengaluru']);
    expect(
      extractBengaluruZones('East Bengaluru, not South Bangalore')
    ).toEqual(['East Bengaluru']);
    expect(
      extractBengaluruZones('CBD, ORR or PBD South are all acceptable')
    ).toEqual(['CBD & Off-CBD', 'ORR', 'PBD South']);
  });
});

describe('normalizeLocalityLabel', () => {
  it('[PRP-001] collapses dotted locality initials without changing ordinary words', () => {
    expect(normalizeLocalityLabel('J. P. Nagar, Bengaluru')).toBe('JP Nagar');
    expect(normalizeLocalityLabel('B.T.M. Layout')).toBe('BTM Layout');
    expect(normalizeLocalityLabel('A Cross, Bengaluru')).toBe('A Cross');
  });
});

describe('localityStems', () => {
  it('splits fused nagar suffixes', () => {
    expect(localityStems('Suryanagar')).toEqual(['surya']);
    expect(localityStems('Vijayanagara')).toEqual(['vijaya']);
  });

  it('drops generic designator tokens', () => {
    expect(localityStems('Surya City')).toEqual(['surya']);
    expect(localityStems('HSR Layout')).toEqual(['hsr']);
    expect(localityStems('Bommasandra Industrial Area')).toEqual([
      'bommasandra',
    ]);
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
    expect(
      textContainsLocality(
        'Bommasandra Industrial Area, Karnataka',
        'Bommasandra'
      )
    ).toBe(true);
  });

  it('matches Suryanagar against a Surya City address', () => {
    expect(
      textContainsLocality('Surya City Layout, Chandapura', 'Suryanagar')
    ).toBe(true);
  });

  it('matches Surya City against a Suryanagar address', () => {
    expect(textContainsLocality('Suryanagar, Anekal Taluk', 'Surya City')).toBe(
      true
    );
  });

  it('matches Electronic City against Electronics City Phase 1', () => {
    expect(
      textContainsLocality(
        'Neeladri Road, Electronics City Phase 1',
        'Electronic City'
      )
    ).toBe(true);
  });

  it('does not equate different localities sharing a designator', () => {
    expect(textContainsLocality('Surya City Layout', 'Electronic City')).toBe(
      false
    );
    expect(textContainsLocality('BTM Layout', 'HSR Layout')).toBe(false);
  });

  it('requires every stem of the label to be present', () => {
    expect(
      textContainsLocality('Sarjapur Main Road', 'Sarjapur Attibele Road')
    ).toBe(false);
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
    location:
      'Plot 27, 20th Main, Phase VIII, KHB Colony, Bangalore, Karnataka',
    sublocality: 'KHB Colony',
    locality_canonical: null,
    project: null,
  };

  it('matches a locality named only in the title', () => {
    expect(rowMatchesLocality(koramangalaRow, 'Koramangala')).toBe(true);
  });

  it('still matches on the other locality fields', () => {
    expect(
      rowMatchesLocality({ sublocality: 'HSR Layout' }, 'HSR Layout')
    ).toBe(true);
    expect(
      rowMatchesLocality({ location: 'Surya City, Chandapura' }, 'Suryanagar')
    ).toBe(true);
    expect(
      rowMatchesLocality({ project: 'Prestige Falcon City' }, 'Falcon City')
    ).toBe(true);
  });

  it('[INB-015] reads "KHB" as a housing-board designator, not a place', () => {
    expect(
      rowMatchesLocality(
        { sublocality: 'Suryanagar phase 1' },
        'KHB Suryanagar Phase'
      )
    ).toBe(true);
    expect(
      rowMatchesLocality(
        { location: 'Surya city phase 3, Bangalore' },
        'KHB Suryanagar Phase'
      )
    ).toBe(true);
    expect(rowMatchesLocality(koramangalaRow, 'KHB Suryanagar Phase')).toBe(
      false
    );
  });

  it('does not match an unrelated locality', () => {
    expect(rowMatchesLocality(koramangalaRow, 'Whitefield')).toBe(false);
    expect(
      rowMatchesLocality({ title: null, location: null }, 'Koramangala')
    ).toBe(false);
  });
});

describe('rowMatchesBengaluruZone', () => {
  it('[INB-003] expands broad Bengaluru zones into their member localities', () => {
    expect(
      rowMatchesBengaluruZone({ sublocality: 'JP Nagar' }, 'South Bangalore')
    ).toBe(true);
    expect(
      rowMatchesBengaluruZone({ sublocality: 'HSR Layout' }, 'South Bengaluru')
    ).toBe(true);
    expect(
      rowMatchesBengaluruZone({ sublocality: 'Whitefield' }, 'East Bangalore')
    ).toBe(true);
    expect(
      rowMatchesBengaluruZone({ sublocality: 'Yelahanka' }, 'North Bengaluru')
    ).toBe(true);
  });

  it('matches established Bengaluru business districts', () => {
    expect(rowMatchesBengaluruZone({ sublocality: 'MG Road' }, 'CBD')).toBe(
      true
    );
    expect(rowMatchesBengaluruZone({ sublocality: 'Bellandur' }, 'ORR')).toBe(
      true
    );
    expect(
      rowMatchesBengaluruZone({ sublocality: 'Whitefield' }, 'PBD East')
    ).toBe(true);
    expect(
      rowMatchesBengaluruZone({ sublocality: 'Electronic City' }, 'PBD South')
    ).toBe(true);
    expect(
      rowMatchesBengaluruZone({ sublocality: 'Devanahalli' }, 'PBD North')
    ).toBe(true);
  });

  it('does not leak a locality into unrelated zones', () => {
    expect(
      rowMatchesBengaluruZone({ sublocality: 'Whitefield' }, 'West Bangalore')
    ).toBe(false);
  });

  it('does not apply Bengaluru zones to another city with the same locality name', () => {
    expect(
      rowMatchesBengaluruZone(
        { city: 'Chennai', sublocality: 'MG Road' },
        'CBD'
      )
    ).toBe(false);
  });
});

describe('textNamesLocality', () => {
  it('[INB-004] reads a locality fused into one word as the name typed in two', () => {
    expect(textNamesLocality('Vijayanbank layout', 'Vijaya Bank Layout')).toBe(
      true
    );
    expect(
      textNamesLocality(
        'Bannerghatta road, Vijayanbank layout, Bangalore, Karnataka',
        'Vijaya Bank Layout'
      )
    ).toBe(true);
    expect(textNamesLocality('Vijaya Bank Layout', 'Vijayanbank layout')).toBe(
      true
    );
  });

  it('[INB-004] forgives one slipped character per stem', () => {
    expect(
      textNamesLocality('near Vijay Bank layout', 'Vijaya Bank Layout')
    ).toBe(true);
    expect(textNamesLocality('Kormangala East, Bengaluru', 'Koramangala')).toBe(
      true
    );
    expect(textNamesLocality('Vijayanbank layout', 'Vijayabank Layout')).toBe(
      true
    );
  });

  it('forgives one transposed pair', () => {
    expect(textNamesLocality('Whitefeild, Bengaluru', 'Whitefield')).toBe(true);
    expect(textNamesLocality('Marathahalli', 'Marathhaalli')).toBe(true);
  });

  it('keeps short stems exact so one slip cannot cross localities', () => {
    expect(textNamesLocality('HBR Layout', 'HSR Layout')).toBe(false);
    expect(textNamesLocality('JC Nagar', 'JP Nagar')).toBe(false);
  });

  it('does not equate different places that happen to be close in spelling length', () => {
    expect(textNamesLocality('Bellandur', 'Bilekahalli')).toBe(false);
    expect(textNamesLocality('Hebbal', 'Hennur')).toBe(false);
    expect(textNamesLocality('Bommasandra', 'Bommanahalli')).toBe(false);
  });
});

describe('localityLabelsMatch', () => {
  it('matches whichever label is the longer form', () => {
    expect(localityLabelsMatch('Koramangala', 'Koramangala 1st Block')).toBe(
      true
    );
    expect(localityLabelsMatch('Koramangala 1st Block', 'Koramangala')).toBe(
      true
    );
    expect(localityLabelsMatch('Domlur', 'Domluru')).toBe(true);
    expect(localityLabelsMatch('BTM Layout', 'HSR Layout')).toBe(false);
  });
});
