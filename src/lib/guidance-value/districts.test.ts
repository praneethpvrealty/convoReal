import { describe, expect, it } from 'vitest';

import {
  districtFromLabel,
  exactDistrict,
  rateDistrict,
  sourceDistrict,
} from './districts';

describe('districtFromLabel', () => {
  it('maps registration districts and old names', () => {
    expect(districtFromLabel('Jayanagar')).toBe('Bengaluru Urban');
    expect(districtFromLabel('Belgaum')).toBe('Belagavi');
    expect(districtFromLabel('Bangalore Rural')).toBe('Bengaluru Rural');
    expect(districtFromLabel('Atlantis')).toBeNull();
  });
});

describe('exactDistrict', () => {
  it('[GVL-015] maps a printed district and its old spellings to one name', () => {
    expect(exactDistrict('Bagalkot')).toBe('Bagalkote');
    expect(exactDistrict('Bellary')).toBe('Ballari');
    expect(exactDistrict('VIJAYAPURA')).toBe('Vijayapura');
    expect(exactDistrict('Bengaluru Urban District')).toBe('Bengaluru Urban');
    expect(exactDistrict('Bangalore')).toBe('Bengaluru Urban');
    expect(exactDistrict('Chamarajanagara')).toBe('Chamarajanagar');
    expect(exactDistrict('Mangaluru')).toBe('Dakshina Kannada');
  });

  it('[GVL-015] does not read a district out of a longer heading', () => {
    expect(exactDistrict('Kollegala')).toBeNull();
    expect(exactDistrict('Not specified')).toBeNull();
    expect(
      exactDistrict('Bengaluru Urban / Rural / Ramanagara / Udupi')
    ).toBeNull();
    expect(exactDistrict('Vijayanagar')).toBeNull();
  });
});

describe('rateDistrict', () => {
  it('[GVL-015] keeps a printed district and falls back to the notification', () => {
    expect(rateDistrict('Bellary', 'Ballari')).toBe('Ballari');
    expect(rateDistrict('Tumakuru', 'Chikkamagalur')).toBe('Tumakuru');
    expect(rateDistrict('Sankeshwar', 'Belagavi')).toBe('Belagavi');
    expect(rateDistrict('Anekal', 'Basavangudi')).toBe('Bengaluru Urban');
    expect(rateDistrict('Central Valuation Committee', 'Bengaluru Rural')).toBe(
      'Bengaluru Rural'
    );
    expect(rateDistrict('18', 'Chamarajanagar')).toBe('Chamarajanagar');
    expect(rateDistrict('Vijayanagar', 'Bengaluru Urban')).toBe(
      'Bengaluru Urban'
    );
    expect(rateDistrict(null, 'Chikkamagalur')).toBe('Chikkamagaluru');
    expect(rateDistrict('Kollegala', null)).toBe('Kollegala');
    expect(rateDistrict(null, null)).toBeNull();
  });
});

describe('sourceDistrict', () => {
  it('[GVL-015] files an uploaded notification under its district', () => {
    expect(sourceDistrict('Basavangudi')).toBe('Bengaluru Urban');
    expect(sourceDistrict('Chikkamagalur')).toBe('Chikkamagaluru');
    expect(sourceDistrict(' Atlantis ')).toBe('Atlantis');
  });
});
