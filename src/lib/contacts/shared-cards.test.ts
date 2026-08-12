import { describe, it, expect } from 'vitest';
import type { ParsedPropertyDraft } from '@/lib/ai/gemini';
import {
  SHARED_CARDS_HEADER,
  parseSharedContactCards,
  ownerFromCard,
  applySharedCardOwner,
} from '@/lib/contacts/shared-cards';

// Verbatim from the thread that prompted this: one phonebook entry
// carrying a person, a property and a second name.
const NADEEM_CARD =
  `${SHARED_CARDS_HEADER}\nNadeem Koramangala 8th Block 2100 Sqft Corner Property Owner Nassur (+91 98861 40608)`;

function draft(overrides: Partial<ParsedPropertyDraft> = {}): ParsedPropertyDraft {
  return {
    title: '2100 Sqft Corner Property in Koramangala 8th Block',
    price: null,
    location: 'Koramangala 8th Block',
    type: 'Residential Land/ Plot',
    sublocality: null,
    city: null,
    state: null,
    bedrooms: null,
    bathrooms: null,
    area_sqft: null,
    land_area: 2100,
    land_area_unit: 'Sq.Ft.',
    description: null,
    features: ['Corner Property'],
    nearby_highlights: null,
    dimensions: null,
    facing_direction: null,
    rental_income: null,
    roi: null,
    google_map_link: null,
    owner_contact_name: 'Nassur',
    owner_contact_phone: '9886140608',
    owner_contact_role: 'Owner',
    images: [],
    ...overrides,
  } as ParsedPropertyDraft;
}

describe('parseSharedContactCards', () => {
  it('reads the name and phone off a forwarded card', () => {
    expect(parseSharedContactCards(NADEEM_CARD)).toEqual([
      {
        name: 'Nadeem Koramangala 8th Block 2100 Sqft Corner Property Owner Nassur',
        phone: '+91 98861 40608',
      },
    ]);
  });

  it('reads every card when several are shared at once', () => {
    const cards = parseSharedContactCards(
      `${SHARED_CARDS_HEADER}\nRamesh HDFC (+91 90000 00001)\nSuresh Plumber (+91 90000 00002)`
    );
    expect(cards.map((c) => c.name)).toEqual(['Ramesh HDFC', 'Suresh Plumber']);
    expect(cards[1].phone).toBe('+91 90000 00002');
  });

  it('keeps only the first number when a card carries several', () => {
    expect(
      parseSharedContactCards(`${SHARED_CARDS_HEADER}\nAnil (+91 90000 00001, +91 90000 00002)`)[0]
    ).toEqual({ name: 'Anil', phone: '+91 90000 00001' });
  });

  it('survives a card with no number at all', () => {
    expect(parseSharedContactCards(`${SHARED_CARDS_HEADER}\nAnil Kumar`)).toEqual([
      { name: 'Anil Kumar', phone: null },
    ]);
  });

  it('finds nothing in an ordinary message', () => {
    expect(parseSharedContactCards('3 BHK in Whitefield, 1.2 crore')).toEqual([]);
    expect(parseSharedContactCards('')).toEqual([]);
    expect(parseSharedContactCards(null)).toEqual([]);
  });
});

describe('ownerFromCard', () => {
  it('keeps the name the card leads with and tags the rest', () => {
    const owner = ownerFromCard({
      name: 'Nadeem Koramangala 8th Block 2100 Sqft Corner Property Owner Nassur',
      phone: '+91 98861 40608',
    });
    expect(owner.name).toBe('Nadeem Koramangala');
    expect(owner.nameTag).toBe('8th Block 2100 Sqft Corner Property Owner Nassur');
  });

  it('leaves a plain name alone', () => {
    expect(ownerFromCard({ name: 'Venkata Prasanna', phone: '+919848194537' })).toEqual({
      name: 'Venkata Prasanna',
      nameTag: null,
      phone: '+919848194537',
    });
  });
});

describe('applySharedCardOwner', () => {
  it("replaces the model's guess with the name the card states", () => {
    const merged = applySharedCardOwner(draft(), NADEEM_CARD);
    expect(merged.owner_contact_name).toBe('Nadeem Koramangala');
    expect(merged.owner_contact_name_tag).toBe(
      '8th Block 2100 Sqft Corner Property Owner Nassur'
    );
    expect(merged.owner_contact_phone).toBe('+91 98861 40608');
    expect(merged.owner_contact_role).toBe('Owner');
  });

  it('leaves the listing itself untouched', () => {
    const merged = applySharedCardOwner(draft(), NADEEM_CARD);
    expect(merged.title).toBe('2100 Sqft Corner Property in Koramangala 8th Block');
    expect(merged.land_area).toBe(2100);
    expect(merged.location).toBe('Koramangala 8th Block');
    expect(merged.features).toEqual(['Corner Property']);
  });

  it('returns a listing that did not come from a card unchanged', () => {
    const typed = draft();
    expect(applySharedCardOwner(typed, '3 BHK in Whitefield, owner Ramesh 9000000001')).toBe(typed);
  });

  it('re-asserts the same person when the card is forwarded into an open draft', () => {
    // The update path re-runs the AI merge over the existing draft, so
    // the card has to win a second time, not just on first sight.
    const once = applySharedCardOwner(draft(), NADEEM_CARD);
    const twice = applySharedCardOwner(
      { ...once, owner_contact_name: 'Nassur', owner_contact_name_tag: null },
      NADEEM_CARD
    );
    expect(twice.owner_contact_name).toBe('Nadeem Koramangala');
    expect(twice.owner_contact_name_tag).toBe(once.owner_contact_name_tag);
    expect(twice.owner_contact_phone).toBe(once.owner_contact_phone);
  });

  it('defaults the role to Owner when the model named nobody', () => {
    const merged = applySharedCardOwner(
      draft({ owner_contact_name: null, owner_contact_phone: null, owner_contact_role: null }),
      NADEEM_CARD
    );
    expect(merged.owner_contact_name).toBe('Nadeem Koramangala');
    expect(merged.owner_contact_role).toBe('Owner');
  });
});
