import { describe, expect, it } from 'vitest';
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

import { parseListingFromImageOrText, updateListingDraft, parseContactFromImageOrText, updateContactDraft } from './gemini';

// Increase test timeout since we are making real generative AI REST calls
describe('Gemini AI WhatsApp Parsers', { timeout: 30000 }, () => {
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
        owner_contact_role: null
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
  });
});
