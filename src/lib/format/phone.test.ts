import { describe, expect, it } from 'vitest';
import { contactPhone, phoneWithCountryCode } from './phone';

describe('phoneWithCountryCode', () => {
  it('prefixes a local ten-digit number with the country code it is given', () => {
    expect(phoneWithCountryCode('98765 43210', '91')).toBe('+919876543210');
    expect(phoneWithCountryCode('4155551212', '1')).toBe('+14155551212');
  });

  it('drops an international 00 prefix and a domestic trunk zero', () => {
    expect(phoneWithCountryCode('0091 98765 43210', '1')).toBe('+919876543210');
    expect(phoneWithCountryCode('09876543210', '44')).toBe('+449876543210');
  });

  it('returns an empty string when there are no digits', () => {
    expect(phoneWithCountryCode(null, '91')).toBe('');
    expect(phoneWithCountryCode('n/a', '91')).toBe('');
  });
});

describe('contactPhone', () => {
  it('accepts every spelling of one number and returns it in E.164', () => {
    for (const raw of [
      '9900277111',
      '09900277111',
      '919900277111',
      '+91 99002-77111',
      '0091 99002 77111',
    ]) {
      expect(contactPhone(raw, '91')).toBe('+919900277111');
    }
  });

  it('rejects input too short or too long to be a reachable number', () => {
    expect(contactPhone('12', '91')).toBeNull();
    expect(contactPhone('99002771', '91')).toBeNull();
    expect(contactPhone('1234567890123456', '91')).toBeNull();
    expect(contactPhone('', '91')).toBeNull();
  });
});
