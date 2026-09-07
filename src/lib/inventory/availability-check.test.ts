import { describe, expect, it } from 'vitest';

import {
  buildPropertyAvailabilityMessage,
  propertyAvailabilityReference,
  propertyAvailabilityWhatsAppUrl,
} from '@/lib/inventory/availability-check';

const property = {
  property_code: 'PROP-1068',
  title: 'Pre-leased commercial building',
};

describe('property availability check', () => {
  it('identifies the listing and asks for changed commercial terms', () => {
    const message = buildPropertyAvailabilityMessage(property, 'Deepak');

    expect(message).toContain('Hello Deepak,');
    expect(message).toContain(
      '*PROP-1068 — Pre-leased commercial building* is still available?'
    );
    expect(message).toContain('latest price/rent and terms');
  });

  it('falls back to the title when a property code is absent', () => {
    expect(
      propertyAvailabilityReference({
        title: 'Corner site in JP Nagar',
      })
    ).toBe('Corner site in JP Nagar');
  });

  it('creates an addressed WhatsApp URL with the message prefilled', () => {
    const url = propertyAvailabilityWhatsAppUrl(
      '+91 98862 17718',
      property,
      'Deepak'
    );

    expect(url).toMatch(/^https:\/\/wa\.me\/919886217718\?text=/);
    expect(decodeURIComponent(url.split('?text=')[1])).toBe(
      buildPropertyAvailabilityMessage(property, 'Deepak')
    );
  });

  it('removes formatting characters from stored names and listing text', () => {
    const message = buildPropertyAvailabilityMessage(
      { property_code: '*PROP-1068*', title: 'Shop  `27th Main`' },
      '  Mr.   Deepak  '
    );

    expect(message).toContain('Hello Mr. Deepak,');
    expect(message).toContain('*PROP-1068 — Shop 27th Main*');
  });
});
