import { describe, it, expect } from 'vitest';
import {
  phoneMatchKey,
  emailMatchKey,
  nameMatchKey,
  namesAreSimilar,
} from '@/lib/contacts/duplicate-key';

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

describe('nameMatchKey', () => {
  it('pairs the same name across case, punctuation and word order', () => {
    const keys = [
      'Ravi Kumar',
      'ravi  kumar',
      'Kumar, Ravi',
      'Mr. Ravi Kumar',
    ].map(nameMatchKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('strips the source annotation an import leaves behind', () => {
    expect(nameMatchKey('Priya Menon (MagicBricks)')).toBe(nameMatchKey('Priya Menon'));
  });

  it('refuses a single name, which is too common to be evidence', () => {
    expect(nameMatchKey('Ravi')).toBeNull();
    expect(nameMatchKey('Mr Ravi')).toBeNull();
  });

  it('ignores a name that carries no letters at all', () => {
    expect(nameMatchKey('+91 98765 43210')).toBeNull();
    expect(nameMatchKey(null)).toBeNull();
  });

  // These are two-token names that clear every other guard, and portal-heavy
  // accounts hold many of them. Grouping them would offer a pile of
  // unrelated buyers as one person.
  it('ignores the placeholder a portal lead is filed under', () => {
    expect(nameMatchKey('Housing Lead')).toBeNull();
    expect(nameMatchKey('MagicBricks Lead')).toBeNull();
    expect(nameMatchKey('Portal Lead')).toBeNull();
    expect(nameMatchKey('99acres Lead')).toBeNull();
  });
});

describe('namesAreSimilar', () => {
  it('reads a one-letter difference in a long name as a typo', () => {
    expect(namesAreSimilar('kumar praneeth', 'kumar praneth')).toBe(true);
  });

  it('does not treat Arun vs Arjun as a typo match', () => {
    expect(namesAreSimilar('arun kumar', 'arjun kumar')).toBe(false);
  });

  it('keeps two different people with the same surname apart', () => {
    expect(namesAreSimilar('kumar ravi', 'sharma ravi')).toBe(false);
  });

  it('will not fuzzy-match a short name, where one edit is most of the word', () => {
    // 'anil dev' vs 'anil deb' is a single edit, but on a name this short
    // that is as likely to be a different person as a typo.
    expect(namesAreSimilar('anil dev', 'anil deb')).toBe(false);
  });
});
