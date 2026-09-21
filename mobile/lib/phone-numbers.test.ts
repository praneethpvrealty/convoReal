import { describe, it, expect } from 'vitest';

import { contactPhoneNumbers, promotePhone } from './phone-numbers';

describe('contact phone numbers', () => {
  it('[CTM-006] offers every number for WhatsApp, primary first', () => {
    expect(
      contactPhoneNumbers({
        phone: '+919113559520',
        secondary_phones: ['+918660109674'],
      })
    ).toEqual(['+919113559520', '+918660109674']);
  });

  it('[CTM-006] promotes an other number to primary and keeps the old primary', () => {
    expect(
      promotePhone(
        { phone: '+919113559520', secondary_phones: ['+918660109674'] },
        '+918660109674'
      )
    ).toEqual({ phone: '+918660109674', secondary_phones: ['+919113559520'] });
  });
});
