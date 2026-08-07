import { describe, it, expect } from 'vitest';
import { phoneMatchKey, emailMatchKey } from '@/lib/contacts/duplicate-key';

describe('phoneMatchKey', () => {
  it('pairs a number saved with and without its country code', () => {
    expect(phoneMatchKey('+919876543210')).toBe(phoneMatchKey('9876543210'));
  });

  it('pairs across trunk prefixes and punctuation', () => {
    const keys = [
      '+91 98765 43210',
      '+919876543210',
      '09876543210',
      '98765-43210',
      '(+91) 9876543210',
    ].map(phoneMatchKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('9876543210');
  });

  it('keeps genuinely different subscribers apart', () => {
    expect(phoneMatchKey('+919876543210')).not.toBe(phoneMatchKey('+919876543211'));
  });

  it('does not truncate a number shorter than a subscriber number', () => {
    expect(phoneMatchKey('1234567')).toBe('1234567');
  });

  it('ignores anything too short to identify a person', () => {
    expect(phoneMatchKey('12345')).toBeNull();
    expect(phoneMatchKey('')).toBeNull();
    expect(phoneMatchKey(null)).toBeNull();
  });
});

describe('emailMatchKey', () => {
  it('pairs across case and surrounding whitespace', () => {
    expect(emailMatchKey('  Sneha@Example.com ')).toBe(emailMatchKey('sneha@example.com'));
  });

  it('ignores a missing or blank address', () => {
    expect(emailMatchKey(null)).toBeNull();
    expect(emailMatchKey('   ')).toBeNull();
  });
});
