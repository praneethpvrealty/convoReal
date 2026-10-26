import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  routeLeadMessage,
  isBuyerRequirementMessage,
  standsDownFromQualification,
  LEAD_ROUTE_EXPLANATIONS,
  carriesRequirementBrief,
} from './lead-routing';

// The router is the one place that says which handler owns a lead's
// message. It exists because that decision used to be written twice —
// once in the ladder, once nowhere at all in the dev simulator — and
// the simulator went on showing agents a reply production had stopped
// sending.

describe('routeLeadMessage', () => {
  it('keeps a rent-to-sale correction out of the generic keyword flow', () => {
    const text =
      'Hi, not interested in renting. Are there commercial properties for sale?';
    expect(routeLeadMessage(text)).toBe('qualification');
    expect(isBuyerRequirementMessage(text)).toBe(true);
  });
  it('sends a photo request to the photos, not the ladder', () => {
    expect(routeLeadMessage('Sir can I get images  images')).toBe(
      'photo_request'
    );
  });

  it('sends a callback request to a person', () => {
    expect(routeLeadMessage('please call me')).toBe('callback_handover');
  });

  it('sends a numbered listing to the listing Q&A', () => {
    expect(routeLeadMessage('option 2')).toBe('shortlist_reference');
  });

  it('keeps a stated requirement with the ladder', () => {
    expect(
      routeLeadMessage(
        'Looking for industrial / commercial lands around the peripherals with high growth potential'
      )
    ).toBe('qualification');
  });

  it('sends a natural reference to the specific-property flow', () => {
    expect(
      routeLeadMessage('1acre in Akshaynagar i saw I was interested in that')
    ).toBe('property_interest');
  });

  it('sends a disinterest message to property_disinterest, not the ladder', () => {
    expect(routeLeadMessage('I am not interested')).toBe(
      'property_disinterest'
    );
    expect(routeLeadMessage('not for me')).toBe('property_disinterest');
    expect(routeLeadMessage("don't like this property")).toBe(
      'property_disinterest'
    );
  });

  it('keeps a stated requirement with the ladder even with disinterest phrasing', () => {
    expect(
      routeLeadMessage(
        'not interested in flat, looking for 30x40 plot in HSR under 1.5cr'
      )
    ).toBe('qualification');
  });

  it('sends a showcase enquiry to the approval card, not the ladder', () => {
    // Verbatim from the Enquire button. "Commercial Land" in the title
    // makes the requirement signal true by construction, and the ladder
    // claiming it answered a buyer who had named the exact listing with
    // "what budget range are you working with?".
    expect(
      routeLeadMessage(
        'Hi! I am interested in your property "50x70 Commercial Land in 6th Block, Koramangala" in 6th Block, Koramangala, Bengaluru. Please share details. (Property ID: PROP-1030)'
      )
    ).toBe('property_enquiry');
  });

  it('treats an empty message as the ladder, which then declines it', () => {
    expect(routeLeadMessage('')).toBe('qualification');
    expect(routeLeadMessage(null)).toBe('qualification');
    expect(routeLeadMessage(undefined)).toBe('qualification');
  });
});

describe('routeLeadMessage — precedence', () => {
  it('lets a callback beat photos: a person brings the photos with them', () => {
    expect(routeLeadMessage('Call me and send the photos')).toBe(
      'callback_handover'
    );
  });

  it('lets a callback beat an enquiry: the person brings the details too', () => {
    expect(
      routeLeadMessage('Please call me about this (Property ID: PROP-1030)')
    ).toBe('callback_handover');
  });

  it('lets photos beat a bare listing number', () => {
    // The subject resolver reads the ordinal separately, so routing
    // this to the photos loses nothing and answers what was asked.
    expect(routeLeadMessage('send photos of option 2')).toBe('photo_request');
  });

  it('keeps a requirement with the ladder even when photos are asked for', () => {
    // The requirement is the part only the ladder can file; the photos
    // follow from the shortlist it replies with.
    expect(
      routeLeadMessage('Looking for a villa in Whitefield, send photos')
    ).toBe('qualification');
  });
});

describe('routeLeadMessage — more listings', () => {
  it.each([
    'More site',
    'more sites please',
    'Any other options?',
    'show me more',
    'anything else?',
    'next',
    'more plots in Vijaya Bank Layout',
  ])('[INB-006] %s → more_listings', (text) => {
    expect(routeLeadMessage(text)).toBe('more_listings');
  });

  it.each([
    'need more area in HSR Layout',
    'looking for a bigger plot, more than 2400 sqft',
    'more details of option 2',
  ])('[INB-006] %s stays with its own handler', (text) => {
    expect(routeLeadMessage(text)).not.toBe('more_listings');
  });
});

describe('standsDownFromQualification', () => {
  it.each([
    ['Sir can I get images  images', true],
    ['please call me', true],
    ['option 2', true],
    ['1acre in Akshaynagar i saw I was interested in that', true],
    ['I am not interested', true],
    ['not for me', true],
    ['Land , 1.5 to 2cr', false],
    ['Devanahalli', false],
    ['More site', false],
  ])('%s → %s', (text, expected) => {
    expect(standsDownFromQualification(text)).toBe(expected);
  });
});

describe('[INB-032] a question about the shared listing goes to the listing Q&A', () => {
  it('routes the pink-house question to the Q&A, and stands the ladder down', () => {
    const text = 'Is it this pink house or house next to it ?';
    expect(routeLeadMessage(text)).toBe('listing_question');
    expect(standsDownFromQualification(text)).toBe(true);
    expect(isBuyerRequirementMessage(text)).toBe(false);
  });

  it('routes an availability question the same way', () => {
    expect(routeLeadMessage('Is this available for sale ?')).toBe(
      'listing_question'
    );
    expect(routeLeadMessage('Is this plot under contract?')).toBe(
      'listing_question'
    );
    expect(isBuyerRequirementMessage('Is this available for sale ?')).toBe(
      false
    );
  });

  it('keeps a question that carries a requirement with the ladder', () => {
    expect(routeLeadMessage('Do you have any villa under 2 Cr?')).toBe(
      'qualification'
    );
    expect(isBuyerRequirementMessage('Do you have any villa under 2 Cr?')).toBe(
      true
    );
  });

  it('lets the earlier carve-outs keep their precedence', () => {
    expect(routeLeadMessage('is this the one? please call me')).toBe(
      'callback_handover'
    );
    expect(routeLeadMessage('can you send photos of this house')).toBe(
      'photo_request'
    );
  });
});

describe('every route is explained for the simulator', () => {
  it.each([
    'callback_handover',
    'property_enquiry',
    'property_interest',
    'property_disinterest',
    'photo_request',
    'shortlist_reference',
    'listing_question',
    'more_listings',
    'qualification',
  ] as const)('%s', (route) => {
    expect(LEAD_ROUTE_EXPLANATIONS[route]).toBeTruthy();
  });
});

// The ladder and the webhook's photo arm are the live consumers. If
// either stops going through the router — or the webhook's photo
// condition drifts from what the router models — the simulator starts
// lying again, silently, which is the whole defect this fixes.
describe('the live handlers still route through here', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('the qualification ladder stands down via the router', () => {
    const source = read('src/lib/ai/buyer-qualification.ts');
    expect(source).toContain('standsDownFromQualification(text)');
    // The inlined guards it replaced must not creep back alongside it.
    expect(source).not.toContain('requestsPropertyPhotos(text)');
    expect(source).not.toContain('parseOrdinalReferences(text).length > 0');
  });

  it("the webhook's photo arm matches the route the router assigns", () => {
    const source = read(
      'src/lib/whatsapp/inbound/chain/steps/lead-question.ts'
    );
    expect(source).toContain(
      'requestsPropertyPhotos(leadText) && !requestsHumanContact(leadText)'
    );
  });

  it('the simulator routes before it runs the ladder', () => {
    const source = read('src/app/api/dev/simulate-chatbot/route.ts');
    const routed = source.indexOf('const route = routeLeadMessage(text)');
    const ladder = source.indexOf('buildQualificationReply(');
    expect(routed).toBeGreaterThan(-1);
    expect(ladder).toBeGreaterThan(routed);
  });
});

describe('[INB-034] a correction that names a shared listing by a figure', () => {
  it('routes "No this 40,000 sqft one" to the listing Q&A, not the ladder', () => {
    expect(routeLeadMessage('No this 40,000 sqft one')).toBe(
      'shortlist_reference'
    );
    expect(routeLeadMessage('I meant the 16 Cr plot')).toBe(
      'shortlist_reference'
    );
    expect(standsDownFromQualification('No this 40,000 sqft one')).toBe(true);
    expect(isBuyerRequirementMessage('No this 40,000 sqft one')).toBe(false);
  });

  it('routes a correction that names the listing by a word of its own', () => {
    expect(routeLeadMessage('No, the Chikatogur one')).toBe(
      'shortlist_reference'
    );
  });

  it('keeps a stated size or budget with the ladder', () => {
    expect(routeLeadMessage('I want a 2400 sqft plot')).toBe('qualification');
    expect(isBuyerRequirementMessage('I want a 2400 sqft plot')).toBe(true);
    expect(routeLeadMessage('I want one 2400 sqft plot')).toBe('qualification');
    expect(isBuyerRequirementMessage('I want one 2400 sqft plot')).toBe(true);
    expect(carriesRequirementBrief('I want one 2400 sqft plot')).toBe(true);
    expect(carriesRequirementBrief("don't like this 3 bhk one")).toBe(false);
    expect(routeLeadMessage('looking for 3 bhk under 2 cr')).toBe(
      'qualification'
    );
  });

  it('lets a callback, a rejection and photos keep their precedence', () => {
    expect(routeLeadMessage('call me about this 40,000 sqft one')).toBe(
      'callback_handover'
    );
    expect(routeLeadMessage("don't like this 3 bhk one")).toBe(
      'property_disinterest'
    );
    expect(routeLeadMessage('send photos of the 40,000 sqft one')).toBe(
      'photo_request'
    );
  });
});

describe('[INB-038] routes read from the October lead threads', () => {
  it.each([
    'what all are available',
    'What else is available?',
    'what all do you have',
    'any other properties available',
  ])('%s → more_listings', (text) => {
    expect(routeLeadMessage(text)).toBe('more_listings');
  });

  it.each(['What plots are available?', 'What sites are available'])(
    '%s names a property type and stays with the ladder',
    (text) => {
      expect(routeLeadMessage(text)).not.toBe('more_listings');
      expect(routeLeadMessage(text)).toBe('qualification');
    }
  );

  it.each(['Location road width', 'Size in sft?', 'rent per month'])(
    '%s → listing_question',
    (text) => {
      expect(routeLeadMessage(text)).toBe('listing_question');
    }
  );

  it.each(['Call ?', 'Can you arrange a meeting with the owner'])(
    '%s → callback_handover',
    (text) => {
      expect(routeLeadMessage(text)).toBe('callback_handover');
    }
  );
});

describe('[CNV-011] the 24 October Suryanagar thread, line by line', () => {
  // A lead tapped Interested on a 1,500 sq.ft plot, asked its
  // dimensions, then disputed the answer. The dispute was read as a
  // requirement, and five replies later the ladder pitched a ₹1.8 Cr
  // house in a locality the lead never named. Every line the lead
  // typed, with the handler that owns it now.
  it.each([
    ['Please share the plot number and block', 'listing_question'],
    ['May ik the dimensions of the plot?', 'listing_question'],
    [
      "Based on the location you've sent, it doesn't seem to be a 30-50 plot",
      'listing_question',
    ],
  ])('%s → %s', (text, route) => {
    expect(routeLeadMessage(text)).toBe(route);
    expect(standsDownFromQualification(text)).toBe(true);
  });

  it.each(['It works', 'Okay sir', 'Ik'])(
    '%s states no requirement, so the ladder has nothing to file',
    (text) => {
      expect(isBuyerRequirementMessage(text)).toBe(false);
    }
  );
});

// The brief a buyer sent on 26 October 2026 at 15:48 IST, verbatim. It
// was answered with "I've noted that … isn't what you're looking for".
const SECTIONED_BRIEF = `My requirement:
==============

COMMERCIAL:
Do u have any property, building or floor INSIDE Tech park in :
1. Outer ring road Tech parks, In between Marathalli and  Sarjapur road
2. Whitefield Tech parks.
3. Budget: Payment Flexibility (20cr-100 cr+).
4. This all property purchase will be registered on my name. Not interested in Investment.

RESIDENTIAL:
1. I need a land piece or plot, where concerned location, per sqft rate is high like 50k per sqft or higher. Example Indiranagar, Koramangala types location..

2. Any property (Flat or villa) , which is bigger in carpet area, not super built up area:
A. Flat: 6k dimension or above.
B. Villa: plot size 6k-8k minimum.

3. Budget: Payment Flexibility (10cr-100 cr+).

4. This all property purchase will be registered on my name. Not interested in Investment, Just Ready to move in.

5. Resale / New property:
- Individual stand alone residential Building/House. G+1 or Higher.
- Plot size : Flexible ; 1800 sqft to 10k+ sqft or Higher.`;

describe('[INB-045] a brief laid out as a requirement is filed, never read as a rejection', () => {
  it('routes the 26 October brief to the ladder', () => {
    expect(carriesRequirementBrief(SECTIONED_BRIEF)).toBe(true);
    expect(routeLeadMessage(SECTIONED_BRIEF)).toBe('qualification');
    expect(isBuyerRequirementMessage(SECTIONED_BRIEF)).toBe(true);
    expect(standsDownFromQualification(SECTIONED_BRIEF)).toBe(false);
  });

  it('files a listed brief without a heading', () => {
    const text =
      'Need:\n1. 3 bhk flat in Whitefield\n2. Budget 2 cr\n3. Not interested in under construction';
    expect(routeLeadMessage(text)).toBe('qualification');
  });

  it('still records a rejection that points at a listing by a figure', () => {
    expect(routeLeadMessage("don't like this 3 bhk one")).toBe(
      'property_disinterest'
    );
    expect(
      routeLeadMessage('Not interested.\nthis 3 bhk one is too costly')
    ).toBe('property_disinterest');
    expect(routeLeadMessage('Not interested')).toBe('property_disinterest');
  });
});
