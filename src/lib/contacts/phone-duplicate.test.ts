import { describe, expect, it } from 'vitest';

import { duplicatePhoneMessage, pickPhoneOwner } from './phone-duplicate';

describe('pickPhoneOwner', () => {
  it('[CTM-018] matches on the last ten digits and skips merged-away records', () => {
    const owner = { id: 'a', phone: '98459 19713', is_merged: false };
    const merged = { id: '0', phone: '+919845919713', is_merged: true };
    const stranger = { id: 'b', phone: '+919845919714', is_merged: false };
    expect(pickPhoneOwner('+919845919713', [stranger, merged, owner])).toBe(
      owner
    );
    expect(pickPhoneOwner('+919845919715', [stranger, owner])).toBeNull();
  });
});

describe('duplicatePhoneMessage', () => {
  it('[CTM-018] names a contact the caller can see and withholds one they cannot', () => {
    expect(
      duplicatePhoneMessage({
        id: 'a',
        visible: true,
        name: 'Lokesh',
        second_name: 'Harohalli',
      })
    ).toMatch(/^Lokesh Harohalli is already saved/);
    const hidden = duplicatePhoneMessage({
      id: 'a',
      visible: false,
      name: 'Lokesh',
      second_name: null,
    });
    expect(hidden).not.toContain('Lokesh');
    expect(hidden).toContain('Ask an admin');
  });
});
