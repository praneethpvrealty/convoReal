import { describe, expect, it } from 'vitest';
import { phoneWithCountryCode } from './phone';

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
