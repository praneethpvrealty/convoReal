// This file used to read .env.local and copy every variable in it into
// process.env, then prefer a real GEMINI_API_KEY over a mock one. That
// put the developer's live service-role key, encryption key and app
// secret into the unit-test process — overwriting the deliberate dummies
// in vitest.config.ts for every file sharing the worker — and made the
// suite's behaviour depend on who was running it. The key now comes from
// vitest.config.ts like the others, and fetch is stubbed per test below.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { generateJson, generateText } from './gemini';
import {
  parseListingFromImageOrText,
  updateListingDraft,
  parseContactFromImageOrText,
  updateContactDraft,
  looksLikePropertyListing,
  looksLikeBuyerRequirement,
  looksLikeOfferedListing,
  draftReadsAsRequirement,
  inferBuyerFromRequirements,
  normalizeClassification,
  promoteClassificationFromNameTag,
  classifyImageOrText,
  normalizeListingFeatures,
} from './gemini';

const requestedModels: string[] = [];

describe('Gemini AI WhatsApp Parsers', { timeout: 30000 }, () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      requestedModels.push(String(url).split('/models/')[1] ?? '');
      const body = init?.body ? JSON.parse(init.body as string) : {};
      const userMessage =
        body.contents?.[0]?.parts?.find((p: { text?: string }) => p.text)
          ?.text || '';
      const systemInstruction = body.systemInstruction?.parts?.[0]?.text || '';

      let mockText = '';

      if (
        systemInstruction.includes('real estate data parser') ||
        systemInstruction.includes('real estate data updater')
      ) {
        // Property Listing Parsing / Updating
        if (userMessage.includes('Prime Corner Commercial Plot')) {
          mockText = JSON.stringify({
            title:
              'Prime Corner Commercial Plot for Sale – Banashankari 6th Stage, 3rd Block',
            price: 56000000,
            location: 'Banashankari 6th Stage, 3rd Block',
            type: 'Commercial Building',
            land_area: 2400,
            land_area_unit: 'Sq.Ft.',
            features: [],
            nearby_highlights: [],
          });
        } else if (userMessage.includes('Ramesh Sajepa')) {
          mockText = JSON.stringify({
            title: '3 BHK House in HSR Layout, 2nd Sector',
            price: 82000000,
            location: 'HSR Layout 2nd Sector',
            type: 'Residential House',
            sublocality: 'HSR Layout 2nd Sector',
            city: 'Bangalore',
            state: 'Karnataka',
            bedrooms: 3,
            bathrooms: 3,
            area_sqft: 2400,
            features: [
              'Basement',
              'Library',
              'Mezzanine',
              'Puja Room',
              'Two Kitchens',
              'Burma Teak Doors and Windows',
              'Italian Marble Flooring',
              'Wood Flooring',
            ],
            nearby_highlights: [],
            owner_contact_name: 'Ramesh Sajepa',
            owner_contact_role: 'Agent',
            owner_contact_phone: '9876543210',
          });
        } else {
          // handles property updates with landmarks and amenities
          mockText = JSON.stringify({
            title: '3 BHK Villa',
            price: 50000000,
            location: 'Sarjapur Road',
            type: 'Villa',
            sublocality: 'Sarjapur',
            city: 'Bangalore',
            state: 'Karnataka',
            bedrooms: 3,
            bathrooms: 3,
            area_sqft: 3000,
            features: ['Power Backup', 'Swimming Pool'],
            nearby_highlights: ['Wipro Office'],
            owner_contact_name: 'Amit',
            owner_contact_role: 'Agent',
            owner_contact_phone: '919876543210',
          });
        }
      } else {
        // Contact Parsing / Updating
        if (
          userMessage.includes('Shreenath') &&
          userMessage.includes('LAKSHMAN')
        ) {
          mockText = JSON.stringify({
            contacts: [
              {
                name: 'Shreenath',
                phone: '91789344713',
                classification: 'Buyer',
                notes: 'SJR Blue Waters, Sarjapur Road Magicbricks',
              },
              {
                name: 'LAKSHMAN',
                phone: '917502598759',
                classification: 'Buyer',
                notes: 'SJR Blue Waters, Sarjapur Road Magicbricks',
              },
              {
                name: 'Praveen',
                phone: '919686194933',
                classification: 'Buyer',
                notes: 'SJR Blue Waters, Sarjapur Road Magicbricks',
              },
              {
                name: 'Omi NA',
                phone: '919986033197',
                classification: 'Buyer',
                notes: 'SJR Blue Waters, Sarjapur Road Magicbricks',
              },
            ],
          });
        } else if (
          userMessage.includes('VaishaliGaur') &&
          !userMessage.includes('referred by Suresh Babu')
        ) {
          mockText = JSON.stringify({
            contacts: [
              {
                name: 'VaishaliGaur',
                phone: '917737932199',
                email: null,
                company: null,
                classification: 'Buyer',
                notes: 'Interested in SJR Blue Waters',
                referrer_name: 'Suresh Babu',
                referrer_phone: null,
              },
            ],
          });
        } else {
          mockText = JSON.stringify({
            contacts: [
              {
                name: 'VaishaliGaur',
                phone: '917737932199',
                email: null,
                company: null,
                classification: 'Buyer',
                notes: 'Interested in SJR Blue Waters',
                referrer_name: 'Suresh Babu',
                referrer_phone: '918888888888',
              },
            ],
          });
        }
      }

      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: mockText,
                  },
                ],
              },
            },
          ],
        }),
      };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
  describe('Property Listing Parsing', () => {
    it('correctly parses amenities, landmarks, and listing owner details', async () => {
      const message = `Hi Swami,
Here are the details for the property you showed interest in:
🏡 *3 BHK House in HSR Layout, 2nd Sector*
📍 Location: HSR Layout 2nd Sector
💰 Price: ₹8.20 Cr
📐 Area: 2400 Sq.Ft.
Highlights:
• Basement | • Library | • Mezzanine | • Puja Room | • Two Kitchens | • Burma Teak Doors and Windows | • Italian Marble Flooring | • Wood Flooring
Please let me know if you would like to arrange a site visit or need more details.
Regards,
Ramesh Sajepa (Agent)
Phone: 9876543210
Aryavarta Ventures`;

      const draft = await parseListingFromImageOrText(message);

      expect(draft.title).toContain('3 BHK House');
      expect(draft.price).toBe(82000000);
      expect(draft.location).toContain('HSR Layout');

      // Verification of amenities vs landmarks
      expect(draft.features).toBeDefined();
      expect(draft.features!.length).toBeGreaterThan(0);
      // "Puja Room" or "Basement" should be parsed as features/amenities, not landmark highlights
      expect(
        draft.features!.some(
          (f) =>
            f.toLowerCase().includes('puja') ||
            f.toLowerCase().includes('basement') ||
            f.toLowerCase().includes('flooring')
        )
      ).toBe(true);

      // Verification of owner/agent referrer
      expect(draft.owner_contact_name).toContain('Ramesh');
      expect(draft.owner_contact_role).toBe('Agent');
      expect(draft.owner_contact_phone).toContain('9876543210');
    });

    it('keeps an explicit commercial plot from being tagged as a building', async () => {
      const draft = await parseListingFromImageOrText(
        'Prime Corner Commercial Plot for Sale – Banashankari 6th Stage, 3rd Block'
      );

      expect(draft.type).toBe('Commercial Plot');
      expect(draft.city).toBeNull();
      expect(draft.state).toBeNull();
    });

    it('handles property updates with landmarks and amenities', async () => {
      const initialDraft = {
        title: '3 BHK Villa',
        price: 50000000,
        location: 'Sarjapur Road',
        type: 'Villa' as const,
        sublocality: 'Sarjapur',
        city: 'Bangalore',
        state: 'Karnataka',
        bedrooms: 3,
        bathrooms: 3,
        area_sqft: 3000,
        land_area: null,
        land_area_unit: 'Sq.Ft.',
        description: null,
        features: ['Power Backup'],
        nearby_highlights: [],
        dimensions: null,
        facing_direction: null,
        rental_income: null,
        roi: null,
        google_map_link: null,
        images: [],
        owner_contact_name: null,
        owner_contact_phone: null,
        owner_contact_role: null,
        listing_type: null,
        rent_per_month: null,
        maintenance: null,
        advance: null,
        gst: null,
      };

      const updated = await updateListingDraft(
        initialDraft,
        'add Swimming Pool to amenities, and the landmark is near Wipro Office. Also contact name is Amit (Agent) 919876543210'
      );

      expect(updated.features).toContain('Swimming Pool');
      expect(updated.features).toContain('Power Backup');
      expect(
        updated.nearby_highlights!.some((h) =>
          h.toLowerCase().includes('wipro')
        )
      ).toBe(true);
      expect(updated.owner_contact_name).toBe('Amit');
      expect(updated.owner_contact_phone).toContain('9876543210');
      expect(updated.owner_contact_role).toBe('Agent');
      expect(requestedModels.at(-1)).toContain('flash-lite');
    });
  });

  describe('Contact Parsing', () => {
    it('correctly parses lead and referrer/sender name', async () => {
      const message = `VaishaliGaur, 917737932199 is interested in SJR Blue Waters.
Please save.
Referred by Suresh Babu.`;

      const container = await parseContactFromImageOrText(message);

      expect(container.contacts.length).toBe(1);
      const contact = container.contacts[0];
      expect(contact.name).toBe('VaishaliGaur');
      expect(contact.phone).toContain('917737932199');
      expect(contact.referrer_name).toBe('Suresh Babu');
    });

    it('handles updates to contact referrers', async () => {
      const initialContainer = {
        contacts: [
          {
            name: 'VaishaliGaur',
            name_tag: null,
            phone: '917737932199',
            email: null,
            company: null,
            classification: 'Buyer' as const,
            notes: 'Interested in SJR Blue Waters',
            requirements: null,
            referrer_name: null,
            referrer_phone: null,
          },
        ],
      };

      const updated = await updateContactDraft(
        initialContainer,
        'referred by Suresh Babu phone 918888888888'
      );

      expect(updated.contacts[0].referrer_name).toBe('Suresh Babu');
      expect(requestedModels.at(-1)).toContain('flash-lite');
      expect(updated.contacts[0].referrer_phone).toContain('918888888888');
    });

    it('parses multi-line lead forwarding messages from user screenshot', async () => {
      const message = `Hi User, Shreenath, 91789344713 is interested in SJR Blue Waters, Sarjapur Road Magicbricks
Hi User, LAKSHMAN, 917502598759 is interested in SJR Blue Waters, Sarjapur Road Magicbricks
Hi User, Praveen, 919686194933 is interested in SJR Blue Waters, Sarjapur Road Magicbricks
Hi User, Omi NA, 919986033197 is interested in SJR Blue Waters, Sarjapur Road Magicbricks`;

      try {
        const container = await parseContactFromImageOrText(message);
        console.log(
          'SUCCESSFUL PARSE CONTAINER:',
          JSON.stringify(container, null, 2)
        );
        expect(container.contacts.length).toBe(4);
      } catch (err) {
        console.error('PARSING FAILED WITH ERROR:', err);
        throw err;
      }
    });
  });
});

describe('looksLikePropertyListing', () => {
  it('treats a forwarded listing ending in owner name+phone as a property', () => {
    const message =
      '571, 16th A Main Rd · Bengaluru, Karnataka\n' +
      '3750 sqft\n50*75\nEast facing\n17cr.\nSite number 569\n' +
      'https://maps.app.goo.gl/abc\nDeepak P\n9886217718';
    expect(looksLikePropertyListing(message)).toBe(true);
  });

  it('keeps a buyer-lead forward as a contact', () => {
    expect(
      looksLikePropertyListing(
        'Praveen, 919686194933 is interested in SJR Blue Waters, 3 BHK'
      )
    ).toBe(false);
  });

  it('keeps a portal lead forward as a contact', () => {
    expect(
      looksLikePropertyListing(
        'Hi User, LAKSHMAN, 917502598759 is interested in SJR Blue Waters Magicbricks'
      )
    ).toBe(false);
  });

  it('does not misclassify a plain contact card', () => {
    expect(
      looksLikePropertyListing('Deepak P\n9886217718\ndeepak@example.com')
    ).toBe(false);
  });

  it('requires more than one property spec to override', () => {
    expect(
      looksLikePropertyListing('Nice villa available, call Deepak 9886217718')
    ).toBe(false);
  });

  it('returns false for empty text', () => {
    expect(looksLikePropertyListing('')).toBe(false);
    expect(looksLikePropertyListing(undefined)).toBe(false);
  });
});

describe('looksLikeBuyerRequirement', () => {
  it('treats an explicit "Requirements -" message as a buyer requirement', () => {
    expect(
      looksLikeBuyerRequirement(
        'Requirements - 4000 sqft residential plots in Koramangala 3rd block or in HSR layout.'
      )
    ).toBe(true);
  });

  it('recognises "looking for" / "wants to buy" / "budget is" phrasing', () => {
    expect(looksLikeBuyerRequirement('looking for a 2BHK in HSR layout')).toBe(
      true
    );
    expect(
      looksLikeBuyerRequirement('client wants to buy a plot near Hosur')
    ).toBe(true);
    expect(looksLikeBuyerRequirement('budget is around 90L')).toBe(true);
  });

  it('does not flag a property listing being offered', () => {
    expect(
      looksLikeBuyerRequirement(
        '3 BHK flat for sale in HSR, 1.2cr, contact owner Raju'
      )
    ).toBe(false);
    expect(
      looksLikeBuyerRequirement(
        '3750 sqft\n50*75\nEast facing\n17cr.\nSite number 569\nDeepak 9886217718'
      )
    ).toBe(false);
  });

  it('returns false for empty text', () => {
    expect(looksLikeBuyerRequirement('')).toBe(false);
    expect(looksLikeBuyerRequirement(undefined)).toBe(false);
  });
});

describe('draftReadsAsRequirement', () => {
  it('catches the buyer brief the listing parser filed as inventory', () => {
    expect(
      draftReadsAsRequirement(
        {
          price: null,
          title:
            '1 Acre Residential Land Requirement in North Bangalore near Airport',
          description: 'Land area 1 acre. Nearby: airport.',
        },
        null
      )
    ).toBe(true);
  });

  it('reads the source text when the title says nothing', () => {
    expect(
      draftReadsAsRequirement(
        { price: null, title: '1 Acre Residential Land', description: null },
        'Looking for North Bangalore near airport, residential land 1 acre, budget 8cr to 10cr'
      )
    ).toBe(true);
  });

  it('leaves a priced listing alone whatever it says', () => {
    expect(
      draftReadsAsRequirement(
        {
          price: 90000000,
          title: 'Residential land matching a 1 acre requirement',
          description: null,
        },
        'looking for buyers'
      )
    ).toBe(false);
  });

  it('leaves a listing whose price the sender simply omitted alone', () => {
    expect(
      draftReadsAsRequirement(
        {
          price: null,
          title: '3 BHK flat in HSR Layout',
          description: 'East facing, 1450 sqft, immediate possession',
        },
        '3 BHK flat in HSR Layout, east facing, 1450 sqft'
      )
    ).toBe(false);
  });
});

describe('inferBuyerFromRequirements', () => {
  it('upgrades an Others contact with requirements to Buyer', () => {
    expect(
      inferBuyerFromRequirements(
        'Others',
        'Looking for 2bhks in purva vantage, hsr layout.'
      )
    ).toBe('Buyer');
  });

  it('leaves Others unchanged when there are no requirements', () => {
    expect(inferBuyerFromRequirements('Others', null)).toBe('Others');
    expect(inferBuyerFromRequirements('Others', '   ')).toBe('Others');
  });

  it('does not override a deliberately set role', () => {
    expect(inferBuyerFromRequirements('Seller', 'Looking for a 2BHK')).toBe(
      'Seller'
    );
    expect(
      inferBuyerFromRequirements('Owner & Buyer', 'wants a plot in Whitefield')
    ).toBe('Owner & Buyer');
  });

  it('leaves an existing Buyer as Buyer', () => {
    expect(inferBuyerFromRequirements('Buyer', 'budget 90L')).toBe('Buyer');
  });
});

describe('normalizeClassification', () => {
  it('maps the local words for the two roles the Engine names differently', () => {
    expect(normalizeClassification('broker')).toBe('Agent');
    expect(normalizeClassification('Broker')).toBe('Agent');
    expect(normalizeClassification('builder')).toBe('Developer');
    expect(normalizeClassification(' Builder ')).toBe('Developer');
  });

  it('still maps the canonical values', () => {
    expect(normalizeClassification('agent')).toBe('Agent');
    expect(normalizeClassification('developer')).toBe('Developer');
    expect(normalizeClassification('owner and buyer')).toBe('Owner & Buyer');
  });

  it('leaves an unrelated profession as Others', () => {
    expect(normalizeClassification('Advocate')).toBe('Others');
    expect(normalizeClassification('Bank DSA')).toBe('Others');
    expect(normalizeClassification(null)).toBe('Others');
  });
});

describe('promoteClassificationFromNameTag', () => {
  it('moves the role an owner typed into the preview\'s "Role" field', () => {
    expect(promoteClassificationFromNameTag('agent', 'Others')).toEqual({
      name_tag: null,
      classification: 'Agent',
    });
  });

  it('reads the words the trade actually uses', () => {
    expect(
      promoteClassificationFromNameTag('broker', 'Others').classification
    ).toBe('Agent');
    expect(
      promoteClassificationFromNameTag('Builder', 'Others').classification
    ).toBe('Developer');
  });

  it('promotes every classification value, however it was cased', () => {
    expect(
      promoteClassificationFromNameTag('Owner', 'Others').classification
    ).toBe('Owner');
    expect(
      promoteClassificationFromNameTag('SELLER', 'Others').classification
    ).toBe('Seller');
    expect(
      promoteClassificationFromNameTag('developer', 'Others').classification
    ).toBe('Developer');
    expect(
      promoteClassificationFromNameTag('owner and buyer', 'Others')
        .classification
    ).toBe('Owner & Buyer');
  });

  it('corrects a classification the parser had already guessed wrong', () => {
    expect(promoteClassificationFromNameTag('agent', 'Buyer')).toEqual({
      name_tag: null,
      classification: 'Agent',
    });
  });

  it('leaves a genuine profession tag alone', () => {
    expect(promoteClassificationFromNameTag('Advocate', 'Buyer')).toEqual({
      name_tag: 'Advocate',
      classification: 'Buyer',
    });
    expect(
      promoteClassificationFromNameTag('Bank DSA', 'Others').name_tag
    ).toBe('Bank DSA');
  });

  it('is a no-op when there is no tag', () => {
    expect(promoteClassificationFromNameTag(null, 'Buyer')).toEqual({
      name_tag: null,
      classification: 'Buyer',
    });
  });
});

describe('normalizeListingFeatures', () => {
  it('replaces "Black and white payment" with "Mixed payment terms"', () => {
    expect(
      normalizeListingFeatures([
        'A Khata',
        'Black and white payment',
        'Corner land',
      ])
    ).toEqual(['A Khata', 'Mixed payment terms', 'Corner land']);
  });

  it('matches casing and "&"/"n" variants', () => {
    expect(normalizeListingFeatures(['Black & White Payment'])).toEqual([
      'Mixed payment terms',
    ]);
    expect(normalizeListingFeatures(['black n white'])).toEqual([
      'Mixed payment terms',
    ]);
  });

  it('dedupes when the neutral label already exists', () => {
    expect(
      normalizeListingFeatures([
        'Mixed payment terms',
        'Black and white payment',
      ])
    ).toEqual(['Mixed payment terms']);
  });

  it('trims, drops empties, and leaves other features untouched', () => {
    expect(
      normalizeListingFeatures(['  Access Road  ', '', 'Fenced Boundary'])
    ).toEqual(['Access Road', 'Fenced Boundary']);
  });

  it('returns an empty array for non-array input', () => {
    expect(normalizeListingFeatures(null)).toEqual([]);
    expect(normalizeListingFeatures(undefined)).toEqual([]);
  });
});

describe('classifyImageOrText image-only override', () => {
  const stubClassifyThenOcr = (ocrText: string) => {
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      const sys = body.systemInstruction?.parts?.[0]?.text || '';
      let text = 'none';
      if (sys.includes('real estate lead classifier')) text = 'contact';
      else if (sys.includes('OCR engine')) text = ocrText;
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text }] } }],
        }),
      };
    });
  };

  afterEach(() => vi.unstubAllGlobals());

  it('reclassifies an image-only listing poster from contact to property', async () => {
    stubClassifyThenOcr(
      '3750 sqft\n50*75\nEast facing\n17cr.\nSite number 569\nDeepak P 9886217718'
    );
    const result = await classifyImageOrText(
      undefined,
      Buffer.from('img'),
      'image/jpeg'
    );
    expect(result).toBe('property');
  });

  it('keeps an image-only contact card as contact', async () => {
    stubClassifyThenOcr('Deepak P\n9886217718\ndeepak@example.com');
    const result = await classifyImageOrText(
      undefined,
      Buffer.from('img'),
      'image/jpeg'
    );
    expect(result).toBe('contact');
  });
});

describe('classifyImageOrText schedule class', () => {
  const stubClassifyThenOcr = (classification: string, ocrText: string) => {
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      const sys = body.systemInstruction?.parts?.[0]?.text || '';
      let text = 'none';
      if (sys.includes('real estate lead classifier')) text = classification;
      else if (sys.includes('OCR engine')) text = ocrText;
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text }] } }],
        }),
      };
    });
  };

  afterEach(() => vi.unstubAllGlobals());

  it('routes a chat screenshot that fixes a meeting to schedule', async () => {
    stubClassifyThenOcr(
      'schedule',
      'Monday 5 pm the meeting with Kusuma lawyer is confirmed right.\nYes Sharan, its confirmed\nThanks'
    );
    const result = await classifyImageOrText(
      undefined,
      Buffer.from('img'),
      'image/jpeg'
    );
    expect(result).toBe('schedule');
  });

  it('keeps a listing poster on property even when the model says schedule', async () => {
    stubClassifyThenOcr(
      'schedule',
      '3750 sqft\n50*75\nEast facing\n17cr.\nVisit on Monday 5pm'
    );
    const result = await classifyImageOrText(
      undefined,
      Buffer.from('img'),
      'image/jpeg'
    );
    expect(result).toBe('property');
  });

  it('keeps a captioned listing on property without an OCR round trip', async () => {
    stubClassifyThenOcr('schedule', 'unused');
    const result = await classifyImageOrText(
      '3 BHK 1450 sqft in HSR for 1.2 crore, visit Monday',
      Buffer.from('img'),
      'image/jpeg'
    );
    expect(result).toBe('property');
  });
});

const LEASE_LISTING_FORWARD = [
  'SPACE AVAILABLE FOR LEASE – BOGANAHALLI, BENGALURU',
  '',
  'Location: New Horizon Gurukul Preschool, Boganahalli, off Bellandur / Kadubeesanahalli.',
  '',
  'Built-up Area:',
  '• Second Floor – 15,526 sq. ft.',
  '• Third Floor – 19,949 sq. ft.',
  '• Total – 35,475 sq. ft.',
  '',
  'Suitable for: Corporate offices, co-working spaces, co-living, student hostels and other suitable commercial uses.',
  '',
  'Property Highlights:',
  '• Previously utilised as a college hostel.',
  '• Ground and first floors are occupied by the preschool and are not available for lease.',
  '• Separate, independent access will be provided.',
  '• Open to internal modifications to suit tenant requirements.',
  '• Floors available independently or together.',
  '',
  'Expected Rental: ₹55 per sq. ft. per month on built-up area (negotiable).',
  '',
  'Google Maps Location:',
  'https://maps.app.goo.gl/5FMHqjtUS81zus8k6',
  '',
  'Floor plans attached. Kindly share with prospective tenants.',
].join('\n');

describe('[JRN-027] a listing that mentions requirements is still a listing', () => {
  const stubClassifier = (classification: string) => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: classification }] } }],
      }),
    }));
  };

  afterEach(() => vi.unstubAllGlobals());

  it('does not read "to suit tenant requirements" as a buyer brief', () => {
    expect(looksLikeBuyerRequirement(LEASE_LISTING_FORWARD)).toBe(false);
    expect(
      looksLikeBuyerRequirement(
        'Bare shell office, can be fitted out as per your requirement. 4200 sqft.'
      )
    ).toBe(false);
    expect(
      looksLikeBuyerRequirement(
        'Warehouse available for rent in Hoskote. Requirements: 6 months deposit.'
      )
    ).toBe(false);
  });

  it('still reads a brief that names itself or asks for a property', () => {
    expect(
      looksLikeBuyerRequirement(
        'Client requirement: office space for lease in Bellandur, 5000 sqft'
      )
    ).toBe(true);
    expect(
      looksLikeBuyerRequirement(
        'Looking for space available for lease near Bellandur to suit our requirements'
      )
    ).toBe(true);
  });

  it('a brief that opens by naming itself wins over offer wording', async () => {
    const briefs = [
      'Client requirement: office space available for lease in Bellandur, 5000 sqft',
      'Client requirement: 2BHK in HSR, expected rent 30k',
      'Wanted 3BHK in Indiranagar, asking price up to 2cr',
    ];
    for (const brief of briefs) {
      expect(looksLikeBuyerRequirement(brief)).toBe(true);
      expect(looksLikeOfferedListing(brief)).toBe(false);
      stubClassifier('property');
      expect(await classifyImageOrText(brief)).toBe('requirement');
      stubClassifier('requirement');
      expect(await classifyImageOrText(brief)).toBe('requirement');
    }
  });

  it('a requirement named mid-message wins over offer wording', async () => {
    const brief =
      'Hi Praneeth, sharing my client requirement. Office space available for lease in Bellandur, 5000 sqft, expected rent 60 per sqft';
    expect(looksLikeBuyerRequirement(brief)).toBe(true);
    expect(looksLikeOfferedListing(brief)).toBe(false);
    stubClassifier('requirement');
    expect(await classifyImageOrText(brief)).toBe('requirement');
    stubClassifier('property');
    expect(await classifyImageOrText(brief)).toBe('requirement');
    expect(
      looksLikeBuyerRequirement(
        'Shop available for rent in Jayanagar, can be partitioned as per client requirement'
      )
    ).toBe(false);
  });

  it('a requirement named in the opening line wins with a preamble or no colon', async () => {
    const briefs = [
      'Hi sir, requirement: office space available for lease in Bellandur, 5000 sqft',
      'Urgent requirement office space available for lease in Bellandur, expected rent 60 per sqft',
    ];
    for (const brief of briefs) {
      expect(looksLikeBuyerRequirement(brief)).toBe(true);
      stubClassifier('requirement');
      expect(await classifyImageOrText(brief)).toBe('requirement');
      stubClassifier('property');
      expect(await classifyImageOrText(brief)).toBe('requirement');
    }
  });

  it('does not rescue a lead forward that repeats offer wording', async () => {
    const forward =
      'Ravi 9886217718 wants to rent a 3 BHK available for rent in HSR';
    expect(looksLikePropertyListing(forward)).toBe(false);
    stubClassifier('contact');
    expect(await classifyImageOrText(forward)).toBe('contact');
  });

  it('reads "to suit our requirement" as the buyer speaking', () => {
    expect(
      looksLikeBuyerRequirement('Need 3BHK to suit our requirement, budget 1cr')
    ).toBe(true);
    expect(
      looksLikeBuyerRequirement('Show me plots as per my requirement')
    ).toBe(true);
  });

  it('keeps the forwarded lease listing on property when the model says property', async () => {
    stubClassifier('property');
    expect(await classifyImageOrText(LEASE_LISTING_FORWARD)).toBe('property');
  });

  it('keeps it on property when the model itself says requirement', async () => {
    stubClassifier('requirement');
    expect(await classifyImageOrText(LEASE_LISTING_FORWARD)).toBe('property');
  });

  it('keeps it on property when the model says contact', async () => {
    stubClassifier('contact');
    expect(looksLikePropertyListing(LEASE_LISTING_FORWARD)).toBe(true);
    expect(await classifyImageOrText(LEASE_LISTING_FORWARD)).toBe('property');
  });

  it('leaves a real brief on requirement whichever way the model reads it', async () => {
    const brief =
      'Looking for North Bangalore near airport, residential land 1 acre, budget 8cr to 10cr';
    stubClassifier('property');
    expect(await classifyImageOrText(brief)).toBe('requirement');
    stubClassifier('requirement');
    expect(await classifyImageOrText(brief)).toBe('requirement');
  });

  it('does not send the parsed draft to client-reply capture when rent is the only price', () => {
    expect(
      draftReadsAsRequirement(
        {
          price: null,
          title: 'Commercial Space for Lease in Boganahalli',
          description:
            'Open to internal modifications to suit tenant requirements.',
        },
        LEASE_LISTING_FORWARD
      )
    ).toBe(false);
  });
});

describe('generationConfig — temperature', () => {
  let sent: Record<string, unknown>[] = [];

  beforeEach(() => {
    sent = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      sent.push(init?.body ? JSON.parse(init.body as string) : {});
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{}' }] } }],
        }),
      } as unknown as Response;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pins structured extraction to zero', async () => {
    // A JSON call has one right answer, so sampling variety is noise —
    // the same brief re-extracted returned a locality as one
    // comma-joined string where the stored value was two, and the buyer
    // ladder read that as new information.
    await generateJson('extract this', 'you are a parser');
    expect(sent[0].generationConfig).toEqual({
      responseMimeType: 'application/json',
      temperature: 0,
    });
  });

  it('leaves free-text generation on the model default', async () => {
    // Descriptions and ad copy are published. At zero, two similar
    // listings write themselves the same page — which is duplicate
    // content on the public listing pages, not a tidier one.
    await generateText('write a description', 'you are a copywriter');
    expect(sent[0].generationConfig).toBeUndefined();
  });
});
