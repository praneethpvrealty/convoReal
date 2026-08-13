import { describe, it, expect } from 'vitest';
import {
  parseListingIdFromUrl,
  parseListingIdFromLead,
  portalKeyFromSource,
  normalizeListingUrl,
} from './listing-identity';

describe('parseListingIdFromUrl', () => {
  it('reads the ad id out of each portal’s listing URL', () => {
    expect(
      parseListingIdFromUrl(
        '99acres',
        'https://www.99acres.com/3-bhk-villa-whitefield-bangalore-spid-R12345678'
      )
    ).toBe('R12345678');
    expect(
      parseListingIdFromUrl(
        '99acres',
        'https://www.99acres.com/npxid-r98765432'
      )
    ).toBe('r98765432');
    expect(
      parseListingIdFromUrl(
        'magicbricks',
        'https://www.magicbricks.com/propertyDetails/villa-whitefield-pdpid-4d4321987654'
      )
    ).toBe('4321987654');
    expect(
      parseListingIdFromUrl(
        'housing',
        'https://housing.com/in/buy/resale/page?property_id=20327451'
      )
    ).toBe('20327451');
  });

  it('refuses a Housing slug rather than storing an id no lead can match', () => {
    // Housing lead emails quote a numeric "Property ID"; its listing
    // URLs carry a slug. Reading the slug as the ad id produced a
    // mapping that silently matched nothing, so the slug forms return
    // null and the agent is asked for the number instead.
    expect(
      parseListingIdFromUrl(
        'housing',
        'https://housing.com/in/buy/resale/page/abc123def-xyz789ghi'
      )
    ).toBe(null);
    expect(
      parseListingIdFromUrl(
        'housing',
        'https://housing.com/in/buy/resale/page/abc123def'
      )
    ).toBe(null);
  });

  it('returns null for a URL with no id and for empty input', () => {
    expect(parseListingIdFromUrl('99acres', 'https://www.99acres.com/')).toBe(
      null
    );
    expect(parseListingIdFromUrl('magicbricks', '')).toBe(null);
    expect(parseListingIdFromUrl('housing', null)).toBe(null);
  });
});

describe('parseListingIdFromLead', () => {
  it('reads only labelled ids, never a bare number', () => {
    expect(
      parseListingIdFromLead('housing', 'Property ID: 20327451\nName: Asha')
    ).toBe('20327451');
    expect(
      parseListingIdFromLead('99acres', 'Listing Code - R12345678\nMobile: 98…')
    ).toBe('R12345678');
    expect(
      parseListingIdFromLead('magicbricks', 'Property Id | 4321987654')
    ).toBe('4321987654');
    expect(
      parseListingIdFromLead('99acres', 'Budget 45000000 for a villa')
    ).toBe(null);
    // MagicBricks writes it mid-sentence, without a colon.
    expect(
      parseListingIdFromLead(
        'magicbricks',
        'A user is interested in your Property, ID 79221031: Industrial Land in Bommasandra'
      )
    ).toBe('79221031');
  });
});

describe('portalKeyFromSource', () => {
  it('maps the wording the parsers store back to a portal key', () => {
    expect(portalKeyFromSource('99acres')).toBe('99acres');
    expect(portalKeyFromSource('MagicBricks')).toBe('magicbricks');
    expect(portalKeyFromSource('Housing.com')).toBe('housing');
    expect(portalKeyFromSource('Manual')).toBe(null);
    expect(portalKeyFromSource(null)).toBe(null);
  });
});

describe('normalizeListingUrl', () => {
  it('strips scheme, www, case, query and trailing slash', () => {
    expect(
      normalizeListingUrl('HTTPS://www.99acres.com/Villa-Whitefield/?utm=x')
    ).toBe('99acres.com/villa-whitefield');
    expect(normalizeListingUrl('housing.com/in/buy/abc')).toBe(
      'housing.com/in/buy/abc'
    );
    expect(normalizeListingUrl(null)).toBe(null);
  });
});
