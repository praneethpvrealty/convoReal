import { describe, expect, it } from 'vitest';

import { parseOwnerDigestCommand } from '@/lib/owners/owner-digest';
import {
  DIGEST_PAUSE_COMMAND,
  DIGEST_RESUME_COMMAND,
  OWNER_DETAILS_SECTIONS,
  OWNER_DETAILS_SECTION_TITLES,
  buildOwnerDetailsRequestMessage,
  defaultOwnerDetailsSections,
  ownerDetailsSectionItems,
  ownerPropertyLabel,
  ownerSalutation,
  respectfulName,
} from '@/lib/owners/details-request';

describe('respectfulName', () => {
  it('keeps an honorific and the first name only', () => {
    expect(respectfulName('Mr Nadeem Ahmed')).toBe('Mr Nadeem');
    expect(respectfulName('Smt. Lakshmi Devi Rao')).toBe('Smt. Lakshmi');
  });

  it('uses the first name when there is no honorific', () => {
    expect(respectfulName('Nadeem Ahmed')).toBe('Nadeem');
  });

  it('falls back for an empty name', () => {
    expect(respectfulName('')).toBe('there');
    expect(respectfulName(null)).toBe('there');
  });
});

describe('ownerSalutation', () => {
  it('reads the clock in IST, not UTC', () => {
    // 15:00 UTC is 20:30 IST — evening there, afternoon here.
    expect(ownerSalutation(new Date('2026-08-12T15:00:00Z'))).toBe(
      'Good evening'
    );
    expect(ownerSalutation(new Date('2026-08-12T03:00:00Z'))).toBe(
      'Good morning'
    );
    expect(ownerSalutation(new Date('2026-08-12T09:00:00Z'))).toBe(
      'Good afternoon'
    );
  });

  it('stays neutral without a clock', () => {
    expect(ownerSalutation()).toBe('Hello');
  });
});

describe('ownerPropertyLabel', () => {
  it('appends the locality when the title does not carry it', () => {
    expect(
      ownerPropertyLabel({
        title: '2100 sqft corner site',
        sublocality: 'Koramangala 8th Block',
      })
    ).toBe('2100 sqft corner site, Koramangala 8th Block');
  });

  it('leaves a title that already names the locality alone', () => {
    expect(
      ownerPropertyLabel({
        title: 'Corner site in Koramangala 8th Block',
        sublocality: 'Koramangala 8th Block',
      })
    ).toBe('Corner site in Koramangala 8th Block');
  });

  it('describes an untitled property by its area', () => {
    expect(ownerPropertyLabel({ city: 'Bengaluru' })).toBe(
      'your property in Bengaluru'
    );
    expect(ownerPropertyLabel(null)).toBe('');
  });
});

describe('defaultOwnerDetailsSections', () => {
  it('never asks a plot owner what is built on it', () => {
    for (const type of [
      'Residential Plot',
      'Residential Land',
      'Agricultural Land',
    ]) {
      expect(defaultOwnerDetailsSections(type)).not.toContain('construction');
    }
  });

  it('asks a built property for its construction', () => {
    for (const type of ['Flat/ Apartment', 'Villa', 'Commercial Shop']) {
      expect(defaultOwnerDetailsSections(type)).toContain('construction');
    }
  });

  it('assumes a built property when the type is unknown', () => {
    expect(defaultOwnerDetailsSections(null)).toEqual(OWNER_DETAILS_SECTIONS);
  });
});

describe('ownerDetailsSectionItems', () => {
  it('asks a plot for its extent and a flat for its floor', () => {
    expect(
      ownerDetailsSectionItems('identity', 'Residential Plot').join(' ')
    ).toContain('total extent');
    expect(
      ownerDetailsSectionItems('identity', 'Flat/ Apartment').join(' ')
    ).toContain('Which floor');
  });

  it('asks a plot for conversion papers and a flat for its sanction', () => {
    expect(
      ownerDetailsSectionItems('papers', 'Residential Plot').join(' ')
    ).toContain('conversion');
    expect(
      ownerDetailsSectionItems('papers', 'Flat/ Apartment').join(' ')
    ).toContain('Approved building plan');
  });

  it('never asks a plot owner about rent or association dues', () => {
    const price = ownerDetailsSectionItems('price', 'Residential Plot').join(
      ' '
    );
    expect(price).not.toMatch(/rented|association/i);
    expect(
      ownerDetailsSectionItems('price', 'Flat/ Apartment').join(' ')
    ).toMatch(/association/i);
  });

  it('asks for photos that suit what is being sold', () => {
    expect(
      ownerDetailsSectionItems('media', 'Residential Plot').join(' ')
    ).toContain('boundary');
    expect(ownerDetailsSectionItems('media', 'Villa').join(' ')).toContain(
      'inside'
    );
  });

  it('has items for every section', () => {
    for (const section of OWNER_DETAILS_SECTIONS) {
      expect(ownerDetailsSectionItems(section, null).length).toBeGreaterThan(0);
    }
  });
});

describe('buildOwnerDetailsRequestMessage', () => {
  const nadeem = {
    ownerName: 'Mr Nadeem',
    propertyLabel: '2100 sqft corner site, Koramangala 8th Block',
    propertyType: 'Residential Plot',
    agentName: 'Praneeth',
    agentPhone: '+91 90000 00000',
    brandName: 'Aryavarta Ventures',
    now: new Date('2026-08-12T15:00:00Z'),
  };

  it('opens the way the agent would', () => {
    const message = buildOwnerDetailsRequestMessage(nadeem);
    expect(message.startsWith('Good evening Mr Nadeem 🙏')).toBe(true);
    expect(message).toContain('Praneeth here from Aryavarta Ventures.');
    expect(message).toContain(
      'Thank you for considering us for 2100 sqft corner site, Koramangala 8th Block.'
    );
  });

  it('numbers the sections it includes, in order', () => {
    const message = buildOwnerDetailsRequestMessage(nadeem);
    const headings = Array.from(message.matchAll(/\*(\d)\. ([^*]+)\*/g)).map(
      ([, n, title]) => [Number(n), title]
    );
    expect(headings).toEqual(
      defaultOwnerDetailsSections('Residential Plot').map((s, i) => [
        i + 1,
        OWNER_DETAILS_SECTION_TITLES[s],
      ])
    );
  });

  it('promises the updates the owner digest actually sends', () => {
    const message = buildOwnerDetailsRequestMessage(nadeem);
    expect(message).toContain('enquires');
    expect(message).toContain('shortlist');
    expect(message).toContain('Site visits');
    expect(message).toContain('this same number keeps you posted');
  });

  // The message hands the owner two commands. The webhook is what has to
  // honour them, so the promise is asserted against the parser itself.
  it('quotes opt-out words the webhook parses back', () => {
    const message = buildOwnerDetailsRequestMessage(nadeem);
    expect(message).toContain(DIGEST_PAUSE_COMMAND);
    expect(message).toContain(DIGEST_RESUME_COMMAND);
    expect(parseOwnerDigestCommand(DIGEST_PAUSE_COMMAND)).toBe('stop');
    expect(parseOwnerDigestCommand(DIGEST_RESUME_COMMAND)).toBe('start');
  });

  it('honours an explicit section selection', () => {
    const message = buildOwnerDetailsRequestMessage({
      ...nadeem,
      sections: ['price', 'papers'],
    });
    expect(message).toContain('*1. Your price and terms*');
    expect(message).toContain('*2. Papers*');
    expect(message).not.toContain('The property itself');
  });

  it('drops the brand, agent and property when the account has none', () => {
    const message = buildOwnerDetailsRequestMessage({ ownerName: 'Nadeem' });
    expect(message.startsWith('Hello Nadeem 🙏')).toBe(true);
    expect(message).toContain(
      'Thank you for considering us for your property.'
    );
    expect(message).not.toContain('undefined');
    expect(message).not.toContain('  ');
  });

  it('stays inside a single WhatsApp message', () => {
    const message = buildOwnerDetailsRequestMessage({
      ...nadeem,
      propertyType: 'Villa',
      sections: OWNER_DETAILS_SECTIONS,
    });
    expect(message.length).toBeLessThan(4096);
  });
});
