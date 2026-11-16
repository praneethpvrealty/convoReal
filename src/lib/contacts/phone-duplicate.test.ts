import { describe, expect, it } from 'vitest';

import {
  duplicatePhoneMessage,
  phoneLookupVariants,
  pickPhoneOwner,
} from './phone-duplicate';

describe('phoneLookupVariants', () => {
  it('[CTM-018] covers every stored spelling of one subscriber number', () => {
    expect(phoneLookupVariants('+91 98459 19713')).toEqual(
      expect.arrayContaining([
        '+91 98459 19713',
        '919845919713',
        '+919845919713',
        '9845919713',
        '09845919713',
      ])
    );
  });
});

describe('pickPhoneOwner', () => {
  it('[CTM-018] matches on the last ten digits and nothing looser', () => {
    const owner = {
      id: 'a',
      name: 'A',
      second_name: null,
      phone: '9845919713',
    };
    const stranger = {
      id: 'b',
      name: 'B',
      second_name: null,
      phone: '+919845919714',
    };
    expect(pickPhoneOwner('+919845919713', [stranger, owner])).toBe(owner);
    expect(pickPhoneOwner('+919845919715', [stranger, owner])).toBeNull();
  });
});

describe('duplicatePhoneMessage', () => {
  it('[CTM-018] names the contact that already has the number', () => {
    expect(
      duplicatePhoneMessage({
        id: 'a',
        name: 'Lokesh',
        second_name: 'Harohalli',
        phone: null,
      })
    ).toMatch(/^Lokesh Harohalli is already saved/);
  });
});
