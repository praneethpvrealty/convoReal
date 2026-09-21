import { describe, it, expect } from 'vitest';
import { contactPhoneNumbers, promotePhone } from './phone-numbers';

describe('contactPhoneNumbers', () => {
  it('[CTM-006] lists the primary first, then the other numbers, without repeats', () => {
    expect(
      contactPhoneNumbers({
        phone: '+919113559520',
        secondary_phones: ['+918660109674', ' +919113559520 ', ''],
      })
    ).toEqual(['+919113559520', '+918660109674']);
  });

  it('[CTM-006] copes with an email-only contact', () => {
    expect(
      contactPhoneNumbers({ phone: null, secondary_phones: null })
    ).toEqual([]);
    expect(
      contactPhoneNumbers({ phone: null, secondary_phones: ['+918660109674'] })
    ).toEqual(['+918660109674']);
  });
});

describe('promotePhone', () => {
  it('[CTM-006] swaps the chosen other number with the primary in place', () => {
    expect(
      promotePhone(
        {
          phone: '+919113559520',
          secondary_phones: ['+911111111111', '+918660109674'],
        },
        '+918660109674'
      )
    ).toEqual({
      phone: '+918660109674',
      secondary_phones: ['+911111111111', '+919113559520'],
    });
  });

  it('[CTM-006] keeps the old primary when the candidate is a new number', () => {
    expect(
      promotePhone(
        { phone: '+919113559520', secondary_phones: [] },
        '+918660109674'
      )
    ).toEqual({ phone: '+918660109674', secondary_phones: ['+919113559520'] });
  });

  it('[CTM-006] gives an email-only contact its first number without inventing a secondary', () => {
    expect(
      promotePhone(
        { phone: null, secondary_phones: ['+918660109674'] },
        '+918660109674'
      )
    ).toEqual({ phone: '+918660109674', secondary_phones: [] });
  });

  it('[CTM-006] is a no-op for the current primary', () => {
    expect(
      promotePhone(
        { phone: '+919113559520', secondary_phones: ['+918660109674'] },
        '+919113559520'
      )
    ).toEqual({ phone: '+919113559520', secondary_phones: ['+918660109674'] });
  });
});
