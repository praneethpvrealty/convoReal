import { describe, expect, it } from 'vitest';
import {
  buildShortlistWhatsAppMessage,
  shortlistWhatsAppLink,
} from './shortlist';

describe('[PRP-059] shortlist sent as one WhatsApp message', () => {
  const properties = [
    { title: '45x60 Plot in JP Nagar', property_code: 'PROP-2489' },
    { title: 'Corner plot in Indiranagar', property_code: null },
  ];

  it('numbers every listing and carries each property code so the inbox resolves it', () => {
    const message = buildShortlistWhatsAppMessage(properties);
    expect(message).toContain('these 2 properties');
    expect(message).toContain(
      '1. 45x60 Plot in JP Nagar (Property ID: PROP-2489)'
    );
    expect(message).toContain('2. Corner plot in Indiranagar');
    expect(message).not.toContain('null');
  });

  it('speaks of one property in the singular', () => {
    expect(buildShortlistWhatsAppMessage([properties[0]])).toContain(
      'this property'
    );
  });

  it('builds a wa.me link to the digits of the agency number, or none without one', () => {
    const link = shortlistWhatsAppLink('+91 98450 12345', properties);
    expect(link).toMatch(/^https:\/\/wa\.me\/919845012345\?text=/);
    expect(decodeURIComponent(link!)).toContain('PROP-2489');
    expect(shortlistWhatsAppLink('', properties)).toBeNull();
  });
});
