import { describe, expect, it } from 'vitest';

import {
  buildInquiryDetailsMessage,
  buildPropertyShareMessage,
} from './share-message';
import type { Property } from './types';

const URL = 'https://acme.convoreal.com/?property_id=p1&v=c1';
const MAP = 'https://maps.app.goo.gl/xyz';

const property = {
  id: 'p1',
  title: '3 BHK in Koramangala',
  type: 'Flat/ Apartment',
  listing_type: 'Sale',
  price: 45000000,
  location: 'Koramangala',
  sublocality: 'Koramangala',
  city: 'Bangalore',
  google_map_link: MAP,
  features: [],
  images: [],
} as unknown as Property;

/** WhatsApp previews the FIRST url in a message, so a map line above
 *  the listing link meant the share arrived carrying a Google Maps
 *  card instead of the property. Web parity: share-message-builder. */
describe('link order', () => {
  it('puts the showcase link above the map link on a complete share', () => {
    const msg = buildPropertyShareMessage({
      property,
      url: URL,
      audience: 'client',
      detail: 'complete',
      tone: 'professional',
    });
    expect(msg).toContain(`🗺 Map: ${MAP}`);
    expect(msg.indexOf(URL)).toBeLessThan(msg.indexOf('maps.app.goo.gl'));
  });

  it('puts the showcase link above the map link on the details reveal', () => {
    const msg = buildInquiryDetailsMessage({ property, url: URL });
    expect(msg).toContain(`🗺 Map: ${MAP}`);
    expect(msg.indexOf(URL)).toBeLessThan(msg.indexOf('maps.app.goo.gl'));
  });

  it('leaves a listing with no map link unchanged', () => {
    const msg = buildPropertyShareMessage({
      property: { ...property, google_map_link: null } as unknown as Property,
      url: URL,
      audience: 'client',
      detail: 'complete',
      tone: 'professional',
    });
    expect(msg).not.toContain('🗺 Map:');
    expect(msg).toContain(URL);
  });
});
