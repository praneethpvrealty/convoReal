import { describe, it, expect } from 'vitest';
import {
  chooseWhatsAppPhone,
  contactPhoneNumbers,
  needsWhatsAppPhoneChoice,
  promotePhone,
} from './phone-numbers';

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

describe('needsWhatsAppPhoneChoice', () => {
  it('[CTM-006] asks only while there is more than one number and no answer yet', () => {
    expect(
      needsWhatsAppPhoneChoice({ phone: '+919113559520', secondary_phones: [] })
    ).toBe(false);
    expect(
      needsWhatsAppPhoneChoice({
        phone: '+919113559520',
        secondary_phones: ['+918660109674'],
      })
    ).toBe(true);
    expect(
      needsWhatsAppPhoneChoice({
        phone: '+918660109674',
        secondary_phones: ['+919113559520'],
        whatsapp_phone_confirmed_at: '2026-09-21T10:00:00.000Z',
      })
    ).toBe(false);
  });
});

describe('chooseWhatsAppPhone', () => {
  it('[CTM-006] makes the answer the primary and stamps it so the question is not repeated', () => {
    const chosen = chooseWhatsAppPhone(
      { phone: '+919113559520', secondary_phones: ['+918660109674'] },
      '+918660109674',
      '2026-09-21T10:00:00.000Z'
    );
    expect(chosen).toEqual({
      phone: '+918660109674',
      secondary_phones: ['+919113559520'],
      whatsapp_phone_confirmed_at: '2026-09-21T10:00:00.000Z',
    });
    expect(needsWhatsAppPhoneChoice(chosen)).toBe(false);
  });

  it('[CTM-006] confirming the current primary changes no numbers', () => {
    expect(
      chooseWhatsAppPhone(
        { phone: '+919113559520', secondary_phones: ['+918660109674'] },
        '+919113559520',
        '2026-09-21T10:00:00.000Z'
      )
    ).toEqual({
      phone: '+919113559520',
      secondary_phones: ['+918660109674'],
      whatsapp_phone_confirmed_at: '2026-09-21T10:00:00.000Z',
    });
  });
});
