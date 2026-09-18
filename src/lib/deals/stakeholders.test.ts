import { describe, expect, it } from 'vitest';

import {
  defaultSideForRole,
  isSamePerson,
  normalizePhone,
  parseStakeholderInput,
} from './stakeholders';

describe('parseStakeholderInput', () => {
  it('[TXW-009] accepts a person with a role and a side, normalising phone and email', () => {
    expect(
      parseStakeholderInput({
        name: '  Adv. Rao  ',
        role: 'advocate',
        side: 'seller',
        phone: '+91 98450 12345',
        email: 'RAO@Example.com ',
        notes: ' handles the EC ',
      })
    ).toEqual({
      ok: true,
      value: {
        name: 'Adv. Rao',
        role: 'advocate',
        side: 'seller',
        phone: '919845012345',
        email: 'rao@example.com',
        contact_id: null,
        notes: 'handles the EC',
      },
    });
  });

  it('defaults the side from the role when none is given', () => {
    expect(defaultSideForRole('seller')).toBe('seller');
    expect(defaultSideForRole('buyer')).toBe('buyer');
    expect(defaultSideForRole('broker')).toBe('internal');
    expect(defaultSideForRole('banker')).toBe('buyer');
    expect(parseStakeholderInput({ name: 'S', role: 'seller' })).toMatchObject({
      ok: true,
      value: { side: 'seller' },
    });
  });

  it('rejects unknown roles, bad sides, bad phones and bad emails', () => {
    expect(parseStakeholderInput({ name: 'X', role: 'notary' })).toEqual({
      ok: false,
      error: 'Unknown stakeholder role',
    });
    expect(
      parseStakeholderInput({ name: 'X', role: 'buyer', side: 'left' })
    ).toEqual({
      ok: false,
      error: 'Side must be buyer, seller or internal',
    });
    expect(
      parseStakeholderInput({ name: 'X', role: 'buyer', phone: '12' })
    ).toEqual({
      ok: false,
      error: 'Phone number looks wrong',
    });
    expect(
      parseStakeholderInput({ name: 'X', role: 'buyer', email: 'nope' })
    ).toEqual({
      ok: false,
      error: 'Email address looks wrong',
    });
    expect(parseStakeholderInput({ name: '', role: 'buyer' })).toEqual({
      ok: false,
      error: 'Name must be 1–120 characters',
    });
  });

  it('normalises phones to digits within E.164 length', () => {
    expect(normalizePhone('+91-98450-12345')).toBe('919845012345');
    expect(normalizePhone('12345')).toBeNull();
  });
});

describe('isSamePerson', () => {
  it('matches by contact first, then phone, then email, and never by name', () => {
    expect(
      isSamePerson(
        { contact_id: 'c1', phone: null, email: null },
        { contact_id: 'c1', phone: '1', email: null }
      )
    ).toBe(true);
    expect(
      isSamePerson(
        { contact_id: 'c1', phone: '919845012345', email: null },
        { contact_id: 'c2', phone: '919845012345', email: null }
      )
    ).toBe(false);
    expect(
      isSamePerson(
        { contact_id: null, phone: '919845012345', email: null },
        { contact_id: 'c2', phone: '919845012345', email: null }
      )
    ).toBe(true);
    expect(
      isSamePerson(
        { contact_id: null, phone: null, email: 'a@b.c' },
        { contact_id: null, phone: null, email: 'a@b.c' }
      )
    ).toBe(true);
    expect(
      isSamePerson(
        { contact_id: null, phone: null, email: null },
        { contact_id: null, phone: null, email: null }
      )
    ).toBe(false);
  });
});
