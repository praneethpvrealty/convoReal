import { describe, expect, it } from 'vitest';

import {
  noteWrite,
  quickAddContactPayload,
  referrerFields,
} from './contact-form';

const base = {
  name: 'Pradeep',
  nameTag: '',
  phone: '9620234650',
  email: '',
  classification: 'Buyer' as const,
};

describe('quickAddContactPayload', () => {
  it('[CTM-012] requires a name', () => {
    expect(quickAddContactPayload({ ...base, name: '   ' })).toEqual({
      error: 'Enter the contact’s name',
    });
  });

  it('[CTM-012] carries the name tag, trimmed, and nulls a blank one', () => {
    const tagged = quickAddContactPayload({ ...base, nameTag: ' Australia ' });
    expect(tagged).toEqual({
      payload: {
        name: 'Pradeep',
        name_tag: 'Australia',
        phone: '+919620234650',
        email: null,
        classification: 'Buyer',
      },
    });
    const blank = quickAddContactPayload(base);
    expect('payload' in blank && blank.payload.name_tag).toBeNull();
  });

  it('still needs a phone or an email, and a valid one', () => {
    expect(quickAddContactPayload({ ...base, phone: '' })).toEqual({
      error: 'Add a phone number or an email',
    });
    expect(quickAddContactPayload({ ...base, phone: '12' })).toHaveProperty(
      'error'
    );
    expect(
      quickAddContactPayload({ ...base, phone: '', email: 'not-an-email' })
    ).toEqual({ error: 'Enter a valid email address' });
    expect(
      quickAddContactPayload({ ...base, phone: '', email: 'Desk@Builder.in' })
    ).toMatchObject({ payload: { phone: null, email: 'desk@builder.in' } });
  });
});

describe('noteWrite', () => {
  it('[CTM-012] inserts a first note and skips an empty one', () => {
    expect(noteWrite(null, '  Visits on Sundays ')).toEqual({
      kind: 'insert',
      text: 'Visits on Sundays',
    });
    expect(noteWrite(null, '  ')).toEqual({ kind: 'none' });
  });

  it('[CTM-012] edits, clears or leaves the most recent note', () => {
    const recent = { id: 'n1', note_text: 'Old' };
    expect(noteWrite(recent, 'Old ')).toEqual({ kind: 'none' });
    expect(noteWrite(recent, 'New')).toEqual({
      kind: 'update',
      id: 'n1',
      text: 'New',
    });
    expect(noteWrite(recent, '')).toEqual({ kind: 'delete', id: 'n1' });
  });
});

describe('referrerFields', () => {
  it('[CTM-012] keeps the linked referrer while the text is unchanged', () => {
    const original = { referrer: 'Ravi', referrer_contact_id: 'c1' };
    expect(referrerFields(original, ' Ravi ')).toEqual({
      referrer: 'Ravi',
      referrer_contact_id: 'c1',
    });
  });

  it('[CTM-012] unlinks when the text changes or is cleared', () => {
    const original = { referrer: 'Ravi', referrer_contact_id: 'c1' };
    expect(referrerFields(original, 'Suresh')).toEqual({
      referrer: 'Suresh',
      referrer_contact_id: null,
    });
    expect(referrerFields(original, '')).toEqual({
      referrer: null,
      referrer_contact_id: null,
    });
  });
});
