import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Load env variables manually from .env.local for vitest
const envPath = resolve(__dirname, '../../../.env.local');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.substring(1, value.length - 1);
      }
      process.env[key] = value;
    }
  }
}

if (!process.env.GEMINI_API_KEY) {
  process.env.GEMINI_API_KEY = 'mock-gemini-api-key-for-testing';
}

import { parseListingFromImageOrText, updateListingDraft, parseContactFromImageOrText, updateContactDraft, looksLikePropertyListing, looksLikeBuyerRequirement, inferBuyerFromRequirements, classifyImageOrText, normalizeListingFeatures } from './gemini';

describe('Gemini AI WhatsApp Parsers', { timeout: 30000 }, () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      const userMessage = body.contents?.[0]?.parts?.find((p: { text?: string }) => p.text)?.text || '';
      const systemInstruction = body.systemInstruction?.parts?.[0]?.text || '';

      let mockText = '';

      if (systemInstruction.includes('real estate data parser') || systemInstruction.includes('real estate data updater')) {
        // Property Listing Parsing / Updating
        if (userMessage.includes('Ramesh Sajepa')) {
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
            features: ['Basement', 'Library', 'Mezzanine', 'Puja Room', 'Two Kitchens', 'Burma Teak Doors and Windows', 'Italian Marble Flooring', 'Wood Flooring'],
            nearby_highlights: [],
            owner_contact_name: 'Ramesh Sajepa',
            owner_contact_role: 'Agent',
            owner_contact_phone: '9876543210'
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
            owner_contact_phone: '919876543210'
          });
        }
      } else {
        // Contact Parsing / Updating
        if (userMessage.includes('Shreenath') && userMessage.includes('LAKSHMAN')) {
          mockText = JSON.stringify({
            contacts: [
              { name: 'Shreenath', phone: '91789344713', classification: 'Buyer', notes: 'SJR Blue Waters, Sarjapur Road Magicbricks' },
              { name: 'LAKSHMAN', phone: '917502598759', classification: 'Buyer', notes: 'SJR Blue Waters, Sarjapur Road Magicbricks' },
              { name: 'Praveen', phone: '919686194933', classification: 'Buyer', notes: 'SJR Blue Waters, Sarjapur Road Magicbricks' },
              { name: 'Omi NA', phone: '919986033197', classification: 'Buyer', notes: 'SJR Blue Waters, Sarjapur Road Magicbricks' },
            ]
          });
        } else if (userMessage.includes('VaishaliGaur') && !userMessage.includes('referred by Suresh Babu')) {
          mockText = JSON.stringify({
            contacts: [{
              name: 'VaishaliGaur',
              phone: '917737932199',
              email: null,
              company: null,
              classification: 'Buyer',
              notes: 'Interested in SJR Blue Waters',
              referrer_name: 'Suresh Babu',
              referrer_phone: null
            }]
          });
        } else {
          mockText = JSON.stringify({
            contacts: [{
              name: 'VaishaliGaur',
              phone: '917737932199',
              email: null,
              company: null,
              classification: 'Buyer',
              notes: 'Interested in SJR Blue Waters',
              referrer_name: 'Suresh Babu',
              referrer_phone: '918888888888'
            }]
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
                    text: mockText
                  }
                ]
              }
            }
          ]
        })
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
PV Realty`;

      const draft = await parseListingFromImageOrText(message);
      
      expect(draft.title).toContain('3 BHK House');
      expect(draft.price).toBe(82000000);
      expect(draft.location).toContain('HSR Layout');
      
      // Verification of amenities vs landmarks
      expect(draft.features).toBeDefined();
      expect(draft.features!.length).toBeGreaterThan(0);
      // "Puja Room" or "Basement" should be parsed as features/amenities, not landmark highlights
      expect(draft.features!.some(f => f.toLowerCase().includes('puja') || f.toLowerCase().includes('basement') || f.toLowerCase().includes('flooring'))).toBe(true);
      
      // Verification of owner/agent referrer
      expect(draft.owner_contact_name).toContain('Ramesh');
      expect(draft.owner_contact_role).toBe('Agent');
      expect(draft.owner_contact_phone).toContain('9876543210');
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
        gst: null
      };

      const updated = await updateListingDraft(
        initialDraft,
        "add Swimming Pool to amenities, and the landmark is near Wipro Office. Also contact name is Amit (Agent) 919876543210"
      );

      expect(updated.features).toContain('Swimming Pool');
      expect(updated.features).toContain('Power Backup');
      expect(updated.nearby_highlights!.some(h => h.toLowerCase().includes('wipro'))).toBe(true);
      expect(updated.owner_contact_name).toBe('Amit');
      expect(updated.owner_contact_phone).toContain('9876543210');
      expect(updated.owner_contact_role).toBe('Agent');
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
        contacts: [{
          name: 'VaishaliGaur',
          phone: '917737932199',
          email: null,
          company: null,
          classification: 'Buyer' as const,
          notes: 'Interested in SJR Blue Waters',
          requirements: null,
          referrer_name: null,
          referrer_phone: null
        }]
      };

      const updated = await updateContactDraft(
        initialContainer,
        "referred by Suresh Babu phone 918888888888"
      );

      expect(updated.contacts[0].referrer_name).toBe('Suresh Babu');
      expect(updated.contacts[0].referrer_phone).toContain('918888888888');
    });

    it('sets name_tag deterministically from a "Name Tag - ..." message without touching name', async () => {
      const initialContainer = {
        contacts: [{
          name: 'Naveen',
          phone: '917019460428',
          email: null,
          company: null,
          classification: 'Seller' as const,
          notes: 'Athni btm owner',
          requirements: null,
          referrer_name: null,
          referrer_phone: null
        }]
      };

      for (const text of ['Name Tag - Athni tower BTM', 'name tag: Athni tower BTM', 'Name tag is Athni tower BTM']) {
        const updated = await updateContactDraft(initialContainer, text);
        expect(updated.contacts[0].name_tag).toBe('Athni tower BTM');
        expect(updated.contacts[0].name).toBe('Naveen');
        expect(updated.contacts[0].notes).toBe('Athni btm owner');
      }
    });

    it('parses multi-line lead forwarding messages from user screenshot', async () => {
      const message = `Hi User, Shreenath, 91789344713 is interested in SJR Blue Waters, Sarjapur Road Magicbricks
Hi User, LAKSHMAN, 917502598759 is interested in SJR Blue Waters, Sarjapur Road Magicbricks
Hi User, Praveen, 919686194933 is interested in SJR Blue Waters, Sarjapur Road Magicbricks
Hi User, Omi NA, 919986033197 is interested in SJR Blue Waters, Sarjapur Road Magicbricks`;

      try {
        const container = await parseContactFromImageOrText(message);
        console.log("SUCCESSFUL PARSE CONTAINER:", JSON.stringify(container, null, 2));
        expect(container.contacts.length).toBe(4);
      } catch (err) {
        console.error("PARSING FAILED WITH ERROR:", err);
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
      looksLikePropertyListing('Praveen, 919686194933 is interested in SJR Blue Waters, 3 BHK')
    ).toBe(false);
  });

  it('keeps a portal lead forward as a contact', () => {
    expect(
      looksLikePropertyListing('Hi User, LAKSHMAN, 917502598759 is interested in SJR Blue Waters Magicbricks')
    ).toBe(false);
  });

  it('does not misclassify a plain contact card', () => {
    expect(looksLikePropertyListing('Deepak P\n9886217718\ndeepak@example.com')).toBe(false);
  });

  it('requires more than one property spec to override', () => {
    expect(looksLikePropertyListing('Nice villa available, call Deepak 9886217718')).toBe(false);
  });

  it('returns false for empty text', () => {
    expect(looksLikePropertyListing('')).toBe(false);
    expect(looksLikePropertyListing(undefined)).toBe(false);
  });
});

describe('looksLikeBuyerRequirement', () => {
  it('treats an explicit "Requirements -" message as a buyer requirement', () => {
    expect(
      looksLikeBuyerRequirement('Requirements - 4000 sqft residential plots in Koramangala 3rd block or in HSR layout.')
    ).toBe(true);
  });

  it('recognises "looking for" / "wants to buy" / "budget is" phrasing', () => {
    expect(looksLikeBuyerRequirement('looking for a 2BHK in HSR layout')).toBe(true);
    expect(looksLikeBuyerRequirement('client wants to buy a plot near Hosur')).toBe(true);
    expect(looksLikeBuyerRequirement('budget is around 90L')).toBe(true);
  });

  it('does not flag a property listing being offered', () => {
    expect(looksLikeBuyerRequirement('3 BHK flat for sale in HSR, 1.2cr, contact owner Raju')).toBe(false);
    expect(
      looksLikeBuyerRequirement('3750 sqft\n50*75\nEast facing\n17cr.\nSite number 569\nDeepak 9886217718')
    ).toBe(false);
  });

  it('returns false for empty text', () => {
    expect(looksLikeBuyerRequirement('')).toBe(false);
    expect(looksLikeBuyerRequirement(undefined)).toBe(false);
  });
});

describe('inferBuyerFromRequirements', () => {
  it('upgrades an Others contact with requirements to Buyer', () => {
    expect(
      inferBuyerFromRequirements('Others', 'Looking for 2bhks in purva vantage, hsr layout.')
    ).toBe('Buyer');
  });

  it('leaves Others unchanged when there are no requirements', () => {
    expect(inferBuyerFromRequirements('Others', null)).toBe('Others');
    expect(inferBuyerFromRequirements('Others', '   ')).toBe('Others');
  });

  it('does not override a deliberately set role', () => {
    expect(inferBuyerFromRequirements('Seller', 'Looking for a 2BHK')).toBe('Seller');
    expect(inferBuyerFromRequirements('Owner & Buyer', 'wants a plot in Whitefield')).toBe('Owner & Buyer');
  });

  it('leaves an existing Buyer as Buyer', () => {
    expect(inferBuyerFromRequirements('Buyer', 'budget 90L')).toBe('Buyer');
  });
});

describe('normalizeListingFeatures', () => {
  it('replaces "Black and white payment" with "Mixed payment terms"', () => {
    expect(
      normalizeListingFeatures(['A Khata', 'Black and white payment', 'Corner land'])
    ).toEqual(['A Khata', 'Mixed payment terms', 'Corner land']);
  });

  it('matches casing and "&"/"n" variants', () => {
    expect(normalizeListingFeatures(['Black & White Payment'])).toEqual(['Mixed payment terms']);
    expect(normalizeListingFeatures(['black n white'])).toEqual(['Mixed payment terms']);
  });

  it('dedupes when the neutral label already exists', () => {
    expect(
      normalizeListingFeatures(['Mixed payment terms', 'Black and white payment'])
    ).toEqual(['Mixed payment terms']);
  });

  it('trims, drops empties, and leaves other features untouched', () => {
    expect(normalizeListingFeatures(['  Access Road  ', '', 'Fenced Boundary'])).toEqual([
      'Access Road',
      'Fenced Boundary',
    ]);
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
      if (sys.includes('real estate CRM classifier')) text = 'contact';
      else if (sys.includes('OCR engine')) text = ocrText;
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
      };
    });
  };

  afterEach(() => vi.unstubAllGlobals());

  it('reclassifies an image-only listing poster from contact to property', async () => {
    stubClassifyThenOcr('3750 sqft\n50*75\nEast facing\n17cr.\nSite number 569\nDeepak P 9886217718');
    const result = await classifyImageOrText(undefined, Buffer.from('img'), 'image/jpeg');
    expect(result).toBe('property');
  });

  it('keeps an image-only contact card as contact', async () => {
    stubClassifyThenOcr('Deepak P\n9886217718\ndeepak@example.com');
    const result = await classifyImageOrText(undefined, Buffer.from('img'), 'image/jpeg');
    expect(result).toBe('contact');
  });
});
