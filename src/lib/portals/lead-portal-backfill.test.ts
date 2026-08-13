import { describe, expect, it } from 'vitest';
import { latestRefsByPhone, recoverPortalRef } from './lead-portal-backfill';

const base = { created_at: '2026-08-12T00:00:00.000Z' };

describe('recoverPortalRef', () => {
  it('recovers each portal from its own wording', () => {
    expect(
      recoverPortalRef({
        ...base,
        sender: '"Housing.com" <noreply@housing-mailer.com>',
        subject: 'Housing - Lead interested in your property',
        body_preview:
          '3 BHK Independent House\nKoramangala\nProperty ID: 20749829',
        extracted_phone: '+919626806002',
      })
    ).toEqual({
      portal: 'housing',
      listingId: '20749829',
      phone: '+919626806002',
    });

    expect(
      recoverPortalRef({
        ...base,
        sender: 'MagicBricks <info@magicbricks.com>',
        subject: 'Response on your Property Listing',
        body_preview:
          'A user is interested in your Property, ID 83691103: 5 BHK , Villa in Krishnarajapura , Bangalore.',
        extracted_phone: '8867503373',
      })
    ).toEqual({
      portal: 'magicbricks',
      listingId: '83691103',
      phone: '8867503373',
    });

    expect(
      recoverPortalRef({
        ...base,
        sender: '99acres <noreply@99acres.com>',
        subject: 'Property Advertisement Response',
        body_preview:
          'You have received a response on Rs8.4 Crore , Commercial Land/Inst. Land in Dollars Colony (K89065520) on 99acres.com',
        extracted_phone: '+91-9342169577',
      })
    ).toEqual({
      portal: '99acres',
      listingId: 'K89065520',
      phone: '+91-9342169577',
    });
  });

  it('identifies the portal from the sender when the body never names it', () => {
    expect(
      recoverPortalRef({
        ...base,
        sender: 'MagicBricks <info@magicbricks.com>',
        subject: 'Response on your Property Listing',
        body_preview: 'A user is interested in your Property, ID 83691103.',
        extracted_phone: '8867503373',
      })?.portal
    ).toBe('magicbricks');
  });

  it('skips a log with nothing to recover or nothing to attach it to', () => {
    // Truncated body — the older logs stored 200 characters, which was
    // often just the HTML header, so most of them carry no id at all.
    expect(
      recoverPortalRef({
        ...base,
        sender: '"Housing.com" <noreply@housing-mailer.com>',
        subject: 'Housing - Lead interested in your property',
        body_preview: '<!DOCTYPE html><html><head><meta charset="utf-8">',
        extracted_phone: '+919626806002',
      })
    ).toBe(null);

    // An id with no phone cannot be attached to a contact.
    expect(
      recoverPortalRef({
        ...base,
        sender: '"Housing.com" <noreply@housing-mailer.com>',
        subject: 'Housing',
        body_preview: 'Property ID: 20749829',
        extracted_phone: null,
      })
    ).toBe(null);

    // Not a portal at all.
    expect(
      recoverPortalRef({
        ...base,
        sender: 'a.friend@gmail.com',
        subject: 'Re: site visit',
        body_preview: 'Property ID: 20749829',
        extracted_phone: '+919626806002',
      })
    ).toBe(null);
  });
});

describe('latestRefsByPhone', () => {
  it('keeps the most recent ad per phone, given newest-first logs', () => {
    const refs = latestRefsByPhone([
      {
        ...base,
        created_at: '2026-08-12T00:00:00.000Z',
        sender: 'Housing <noreply@housing-mailer.com>',
        subject: 'Housing',
        body_preview: 'Property ID: 20749829',
        extracted_phone: '+919626806002',
      },
      {
        ...base,
        created_at: '2026-06-01T00:00:00.000Z',
        sender: 'Housing <noreply@housing-mailer.com>',
        subject: 'Housing',
        body_preview: 'Property ID: 20327451',
        extracted_phone: '+919626806002',
      },
    ]);

    expect(refs.size).toBe(1);
    expect(refs.get('+919626806002')?.listingId).toBe('20749829');
  });
});
