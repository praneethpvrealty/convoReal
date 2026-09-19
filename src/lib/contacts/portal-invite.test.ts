import { describe, expect, it } from 'vitest';

import type { Contact } from '@/types';
import {
  buildPortalInviteMessage,
  buildPortalInviteUrl,
  describePortalInviteFilters,
  portalInviteButtonParams,
  portalInviteFilters,
} from './portal-invite';

const buyer = {
  id: 'contact-9',
  name: 'Pramod Shivanna',
  phone: '919480611236',
  areas_of_interest: ['BTM 2nd Stage', 'Vijaya Bank Layout'],
  property_interests: ['Vacant plot'],
  pref_listing_types: ['Sale'],
} as Contact;

describe('portalInviteFilters', () => {
  it("[CTM-002] opens the portal on the contact's first area, interest and intent", () => {
    expect(portalInviteFilters(buyer)).toEqual({
      search: 'BTM 2nd Stage',
      category: 'Vacant plot',
      listingType: 'Sale',
    });
  });

  it('[CTM-002] falls back to the active requirement profile and the unfiltered portal', () => {
    expect(
      portalInviteFilters({
        id: 'c',
        requirement_profiles: [
          {
            id: 'p',
            raw_text: '2 BHK near Whitefield',
            property_types: ['Flat/ Apartment'],
            property_categories: [],
            areas: ['Whitefield'],
            active: true,
          },
        ],
      } as unknown as Contact)
    ).toMatchObject({ category: 'Flat/ Apartment', search: 'Whitefield' });
    expect(portalInviteFilters({ id: 'c', name: 'A' } as Contact)).toEqual({
      search: null,
      category: null,
      listingType: null,
    });
  });
});

describe('buildPortalInviteUrl', () => {
  it('[CTM-002] carries the filters and attributes the visit to the contact', () => {
    expect(
      buildPortalInviteUrl(
        'https://convoreal.com/?ref=account-1',
        buyer,
        portalInviteFilters(buyer)
      )
    ).toBe(
      'https://convoreal.com/?ref=account-1&listing_type=Sale&category=Vacant+plot&search=BTM+2nd+Stage&v=contact-9'
    );
  });
});

describe('buildPortalInviteMessage', () => {
  it('[CTM-002] tells the buyer to filter, shortlist and send the enquiry from the portal', () => {
    const url =
      'https://aryavarta.convoreal.com/?listing_type=Sale&category=Vacant+plot&search=BTM+2nd+Stage&v=contact-9';
    expect(
      buildPortalInviteMessage({
        contactName: buyer.name,
        agentName: 'Praneeth',
        brandName: 'Aryavarta Realty',
        portalUrl: url,
        filters: portalInviteFilters(buyer),
      })
    ).toBe(
      `Hi Pramod 👋
I'm Praneeth from Aryavarta Realty.

Here is our property portal, where every listing is verified and kept up to date by our team:
${url}

You can search and filter by location, budget, property type and more to find the properties that match your requirements. It already opens on vacant plot for sale in BTM 2nd Stage for you — change the filters any time to widen the search.

Shortlist the ones you like and send the enquiry from the portal — it reaches me directly, and I'll take it forward from there with photos, exact locations and site visits.`
    );
  });

  it('reads cleanly with no name, no brand and no filters', () => {
    const message = buildPortalInviteMessage({
      portalUrl: 'https://convoreal.com/?v=c',
    });
    expect(message.startsWith('Hi 👋\n\nHere is our property portal')).toBe(
      true
    );
    expect(message).toContain('Use the filters at the top');
    expect(describePortalInviteFilters(null)).toBe('');
  });
});

describe('portalInviteButtonParams', () => {
  it("[CTM-002] feeds the tracked query into the template's dynamic URL button only", () => {
    expect(
      portalInviteButtonParams(
        [
          { type: 'QUICK_REPLY' },
          { type: 'QUICK_REPLY' },
          { type: 'URL', url: 'https://aryavarta.convoreal.com/{{1}}' },
        ],
        'https://aryavarta.convoreal.com/?category=Vacant+plot&v=contact-9'
      )
    ).toEqual({ 2: '?category=Vacant+plot&v=contact-9' });
    expect(
      portalInviteButtonParams(null, 'https://convoreal.com/?v=c')
    ).toEqual({});
  });
});
