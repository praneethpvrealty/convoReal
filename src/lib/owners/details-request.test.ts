import { describe, expect, it } from 'vitest';

import { parseOwnerDigestCommand } from '@/lib/owners/owner-digest';
import {
  DIGEST_PAUSE_COMMAND,
  DIGEST_RESUME_COMMAND,
  OWNER_DETAILS_SECTIONS,
  OWNER_DETAILS_SECTION_TITLES,
  PAPERS_LATER_NOTE,
  availableOwnerDetailsSections,
  buildOwnerDetailsRequestMessage,
  defaultOwnerDetailsSections,
  ownerDetailsSectionItems,
  ownerHandoverLink,
  ownerPropertyLabel,
  ownerSalutation,
  renderOwnerDetailsTemplate,
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

  // Regression: a title carrying only the locality's opening word got
  // the whole sublocality appended, greeting the owner about their
  // "Property in Koramangala, Koramangala 8th block".
  it('completes a locality the title only half-names', () => {
    expect(
      ownerPropertyLabel({
        title: '2100 Sq.Ft. Property in Koramangala',
        sublocality: 'Koramangala 8th block',
      })
    ).toBe('2100 Sq.Ft. Property in Koramangala 8th block');
  });

  it('does not complete a locality mentioned mid-title', () => {
    // Nothing to append onto the end, so it stays as written rather
    // than producing "...well located 8th Block".
    expect(
      ownerPropertyLabel({
        title: 'Koramangala 8th Block plot, well located',
        sublocality: 'Koramangala 8th Block',
      })
    ).toBe('Koramangala 8th Block plot, well located');
  });

  it('describes an untitled property by its area', () => {
    expect(ownerPropertyLabel({ city: 'Bengaluru' })).toBe(
      'your property in Bengaluru'
    );
    expect(ownerPropertyLabel(null)).toBe('');
  });
});

describe('availableOwnerDetailsSections', () => {
  it('never offers a plot owner what is built on it', () => {
    for (const type of [
      'Residential Plot',
      'Residential Land',
      'Agricultural Land',
    ]) {
      expect(availableOwnerDetailsSections(type)).not.toContain('construction');
    }
  });

  it('offers a built property its construction', () => {
    for (const type of ['Flat/ Apartment', 'Villa', 'Commercial Shop']) {
      expect(availableOwnerDetailsSections(type)).toContain('construction');
    }
  });

  it('assumes a built property when the type is unknown', () => {
    expect(availableOwnerDetailsSections(null)).toEqual(OWNER_DETAILS_SECTIONS);
  });
});

describe('defaultOwnerDetailsSections', () => {
  // The whole point of the first ask: documents change hands after a
  // buyer is finalised and the token is paid, never in the opening
  // message.
  it('never asks for papers or the ownership interrogation up front', () => {
    for (const type of ['Residential Plot', 'Flat/ Apartment', null]) {
      const sections = defaultOwnerDetailsSections(type);
      expect(sections).not.toContain('papers');
      expect(sections).not.toContain('possession');
    }
  });

  it('asks what it is, what it costs and what it looks like', () => {
    expect(defaultOwnerDetailsSections('Residential Plot')).toEqual([
      'identity',
      'price',
      'media',
    ]);
    expect(defaultOwnerDetailsSections('Villa')).toEqual([
      'identity',
      'construction',
      'price',
      'media',
    ]);
  });

  it('stays a subset of what the property can be asked', () => {
    for (const type of ['Residential Plot', 'Villa', null]) {
      const available = availableOwnerDetailsSections(type);
      for (const section of defaultOwnerDetailsSections(type)) {
        expect(available).toContain(section);
      }
    }
  });
});

describe('ownerHandoverLink', () => {
  // The link points at the BUSINESS number, not the owner's — it is
  // what moves the conversation off the agent's personal phone, and the
  // pre-filled command is what records digest consent on arrival.
  it('points at the office number with START UPDATES pre-filled', () => {
    expect(ownerHandoverLink({ phone: '+91 80 4567 8900' })).toBe(
      'https://wa.me/918045678900?text=START%20UPDATES'
    );
  });

  it('carries a sandbox tenant code ahead of the command', () => {
    expect(
      ownerHandoverLink({ phone: '+1 555 0100', prefix: '#AB12 ' })
    ).toContain('%23AB12%20START%20UPDATES');
  });
});

describe('renderOwnerDetailsTemplate', () => {
  it('substitutes the placeholders it knows', () => {
    expect(
      renderOwnerDetailsTemplate('Hi {{owner_name}} — {{ brand_name }} here.', {
        owner_name: 'Mr Nadeem',
        brand_name: 'Aryavarta',
      })
    ).toBe('Hi Mr Nadeem — Aryavarta here.');
  });

  // A typo should be visible in the settings preview, not silently blank.
  it('leaves an unknown placeholder alone', () => {
    expect(
      renderOwnerDetailsTemplate('{{owner_nmae}}', { owner_name: 'x' })
    ).toBe('{{owner_nmae}}');
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
    engineLink: ownerHandoverLink({ phone: '+91 80 4567 8900' }),
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

  it('asks for no documents, and says so', () => {
    const message = buildOwnerDetailsRequestMessage(nadeem);
    expect(message).toContain(PAPERS_LATER_NOTE);
    expect(message).not.toContain('Encumbrance certificate');
    expect(message).not.toContain('Mother deed');
  });

  // Turning papers on is the token-payment stage, and the reassurance
  // that no documents are needed would then be a lie.
  it('drops the papers-later note once papers are being asked for', () => {
    const message = buildOwnerDetailsRequestMessage({
      ...nadeem,
      sections: ['identity', 'papers'],
    });
    expect(message).toContain('*2. Papers*');
    expect(message).not.toContain(PAPERS_LATER_NOTE);
    expect(message).toContain('I need the file itself');
  });

  it('hands the owner over to the office number', () => {
    const message = buildOwnerDetailsRequestMessage(nadeem);
    expect(message).toContain('our office WhatsApp');
    expect(message).toContain(
      'https://wa.me/918045678900?text=START%20UPDATES'
    );
    expect(message).toContain('One tap opens the chat');
  });

  it('asks them to reply where they are when no number is connected', () => {
    const message = buildOwnerDetailsRequestMessage({
      ...nadeem,
      engineLink: null,
    });
    expect(message).not.toContain('wa.me');
    expect(message).toContain('right here');
    expect(message).toContain('our business number keeps you posted');
  });

  // The second route: whoever would rather fill a form once than type a
  // listing into a chat — an agent sitting on a brochure, usually.
  it('offers the public listing page alongside the office number', () => {
    const message = buildOwnerDetailsRequestMessage({
      ...nadeem,
      listingLink: 'https://aryavartaventures.convoreal.com/list?ref=acc-1',
    });
    expect(message).toContain('our office WhatsApp');
    expect(message).toContain(
      'https://aryavartaventures.convoreal.com/list?ref=acc-1'
    );
    expect(message).toContain(
      'photos and the brochure upload straight into it'
    );
  });

  it('offers the page even when no office number is connected', () => {
    const message = buildOwnerDetailsRequestMessage({
      ...nadeem,
      engineLink: null,
      listingLink: 'https://convoreal.com/list?ref=acc-1',
    });
    expect(message).toContain('https://convoreal.com/list?ref=acc-1');
    expect(message).toContain('right here');
  });

  it('says nothing about a page the account does not have', () => {
    const message = buildOwnerDetailsRequestMessage(nadeem);
    expect(message).not.toContain('/list?ref=');
    expect(message).not.toContain('fill it in once');
  });

  // What the seller or agent gets out of answering — the reason they
  // bother at all.
  it('says what listing it does for them', () => {
    const message = buildOwnerDetailsRequestMessage(nadeem);
    expect(message).toContain('*Why this is worth the ten minutes*');
    expect(message).toContain('a page of its own');
    expect(message).toContain('portals');
  });

  it('promises the updates the owner digest actually sends', () => {
    const message = buildOwnerDetailsRequestMessage(nadeem);
    expect(message).toContain('enquires');
    expect(message).toContain('shortlist');
    expect(message).toContain('Site visits');
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

  // Regression: the settings preview passed an account-level selection
  // (which includes 'construction', since it is set once for every
  // property type) together with a plot, and the builder only checked
  // that each name was a real section — so the preview showed a plot
  // owner being asked for bedrooms, balconies and a lift.
  it('drops a section the property cannot be asked, even when told to', () => {
    const message = buildOwnerDetailsRequestMessage({
      ...nadeem,
      propertyType: 'Residential Plot',
      sections: ['identity', 'construction', 'price', 'media'],
    });
    expect(message).not.toContain('What is built on it');
    expect(message).not.toContain('bedrooms, bathrooms, balconies');
    expect(message).toContain('*2. Your price and terms*');
  });

  it('still asks a built property what is built on it', () => {
    const message = buildOwnerDetailsRequestMessage({
      ...nadeem,
      propertyType: 'Villa',
      sections: ['identity', 'construction', 'price', 'media'],
    });
    expect(message).toContain('*2. What is built on it*');
  });

  it('honours an explicit section selection', () => {
    const message = buildOwnerDetailsRequestMessage({
      ...nadeem,
      sections: ['price', 'media'],
    });
    expect(message).toContain('*1. Your price and terms*');
    expect(message).toContain('*2. Photos and location*');
    expect(message).not.toContain('The property itself');
  });

  it("uses the account's own wording when it has one", () => {
    const message = buildOwnerDetailsRequestMessage({
      ...nadeem,
      bodyTemplate:
        '{{salutation}} {{owner_name}}, about {{property}}:\n\n{{checklist}}\n\nSend to {{engine_link}}\n— {{agent_name}}',
    });
    expect(message.startsWith('Good evening Mr Nadeem, about 2100 sqft')).toBe(
      true
    );
    expect(message).toContain('*1. The property itself*');
    expect(message).toContain('Send to https://wa.me/918045678900');
    expect(message.endsWith('— Praneeth')).toBe(true);
    // The built-in prose is fully replaced, not wrapped around.
    expect(message).not.toContain(PAPERS_LATER_NOTE);
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
