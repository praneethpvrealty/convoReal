import { describe, it, expect } from 'vitest';

import {
  chooseWhatsAppPhone,
  contactPhoneNumbers,
  needsWhatsAppPhoneChoice,
  promotePhone,
} from './phone-numbers';

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

describe('WhatsApp number choice', () => {
  it('[CTM-006] asks once: the answer becomes the primary and is remembered', () => {
    const before = {
      phone: '+919113559520',
      secondary_phones: ['+918660109674'],
    };
    expect(needsWhatsAppPhoneChoice(before)).toBe(true);
    const after = chooseWhatsAppPhone(
      before,
      '+918660109674',
      '2026-09-21T10:00:00.000Z'
    );
    expect(after.phone).toBe('+918660109674');
    expect(needsWhatsAppPhoneChoice(after)).toBe(false);
  });
});
