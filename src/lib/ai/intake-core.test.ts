import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  deriveDraftStatus,
  validateDraft,
  validateContactDraftsContainer,
  formatDraftPreviewMessage,
  formatContactDraftsPreview,
  backfillLocationFromMapLink,
} from '@/lib/ai/intake-core';
import { resolveLocationFromGoogleMapLink } from '@/lib/maps/resolve-location';
import type {
  ParsedPropertyDraft,
  ParsedContactDraft,
  ParsedContactDraftsContainer,
} from '@/lib/ai/gemini';

vi.mock('@/lib/maps/resolve-location', () => ({
  resolveLocationFromGoogleMapLink: vi.fn(),
}));
const mockResolve = vi.mocked(resolveLocationFromGoogleMapLink);

// Fully-null draft; each test overrides only the fields it exercises.
function makeDraft(overrides: Partial<ParsedPropertyDraft> = {}): ParsedPropertyDraft {
  return {
    title: null,
    price: null,
    location: null,
    type: null,
    sublocality: null,
    city: null,
    state: null,
    bedrooms: null,
    bathrooms: null,
    area_sqft: null,
    land_area: null,
    land_area_unit: null,
    description: null,
    features: null,
    nearby_highlights: null,
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
    ...overrides,
  };
}

function makeContact(overrides: Partial<ParsedContactDraft> = {}): ParsedContactDraft {
  return {
    name: null,
    phone: null,
    email: null,
    company: null,
    classification: 'Others',
    notes: null,
    referrer_name: null,
    referrer_phone: null,
    ...overrides,
  };
}

function makeContainer(contacts: ParsedContactDraft[]): ParsedContactDraftsContainer {
  return { contacts };
}

describe('backfillLocationFromMapLink', () => {
  beforeEach(() => {
    mockResolve.mockReset();
  });

  it('leaves the draft untouched when location is already present', async () => {
    const draft = makeDraft({ location: 'HSR Layout', google_map_link: 'https://maps.app.goo.gl/x' });
    const result = await backfillLocationFromMapLink(draft);
    expect(result).toBe(draft);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('leaves the draft untouched when there is no map link', async () => {
    const draft = makeDraft({ location: null, google_map_link: null });
    const result = await backfillLocationFromMapLink(draft);
    expect(result).toBe(draft);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('fills location from the resolved map link when missing', async () => {
    mockResolve.mockResolvedValue('Koramangala, Bengaluru');
    const draft = makeDraft({ location: null, google_map_link: 'https://maps.app.goo.gl/y' });
    const result = await backfillLocationFromMapLink(draft);
    expect(result.location).toBe('Koramangala, Bengaluru');
    expect(mockResolve).toHaveBeenCalledWith('https://maps.app.goo.gl/y');
  });

  it('keeps the draft unchanged when resolution returns null', async () => {
    mockResolve.mockResolvedValue(null);
    const draft = makeDraft({ location: null, google_map_link: 'https://maps.app.goo.gl/z' });
    const result = await backfillLocationFromMapLink(draft);
    expect(result).toBe(draft);
    expect(result.location).toBeNull();
  });
});

describe('deriveDraftStatus', () => {
  it('maps valid → awaiting_confirmation', () => {
    expect(deriveDraftStatus(true)).toBe('awaiting_confirmation');
  });
  it('maps invalid → collecting', () => {
    expect(deriveDraftStatus(false)).toBe('collecting');
  });
});

describe('validateDraft', () => {
  it('accepts a complete sale draft', () => {
    const draft = makeDraft({ title: 'HSR 3BHK', price: 15000000, location: 'HSR Layout' });
    expect(validateDraft(draft)).toEqual({ isValid: true, missingFields: [] });
  });

  it('accepts a complete rent draft (rent instead of price)', () => {
    const draft = makeDraft({
      title: 'HSR 2BHK for rent',
      listing_type: 'Rent',
      rent_per_month: 35000,
      location: 'HSR Layout',
    });
    expect(validateDraft(draft)).toEqual({ isValid: true, missingFields: [] });
  });

  it('flags missing title, price, and location in order', () => {
    const result = validateDraft(makeDraft());
    expect(result.isValid).toBe(false);
    expect(result.missingFields).toEqual(['Title', 'Price', 'Location']);
  });

  it('requires Rent (not Price) when listing_type is Rent', () => {
    const draft = makeDraft({ title: 'x', location: 'y', listing_type: 'Rent' });
    expect(validateDraft(draft).missingFields).toEqual(['Rent']);
  });

  it('treats price of 0 as missing', () => {
    const draft = makeDraft({ title: 'x', location: 'y', price: 0 });
    expect(validateDraft(draft).missingFields).toEqual(['Price']);
  });

  it('treats rent_per_month of 0 as missing', () => {
    const draft = makeDraft({ title: 'x', location: 'y', listing_type: 'Rent', rent_per_month: 0 });
    expect(validateDraft(draft).missingFields).toEqual(['Rent']);
  });

  it('treats whitespace-only title and location as missing', () => {
    const draft = makeDraft({ title: '   ', price: 100, location: '  ' });
    expect(validateDraft(draft).missingFields).toEqual(['Title', 'Location']);
  });
});

describe('validateContactDraftsContainer', () => {
  it('rejects an empty container', () => {
    expect(validateContactDraftsContainer(makeContainer([]))).toEqual({
      isValid: false,
      missingFields: ['No contacts found'],
      invalidCount: 0,
    });
  });

  it('accepts a container of valid contacts', () => {
    const container = makeContainer([makeContact({ name: 'Ravi', phone: '9876543210' })]);
    expect(validateContactDraftsContainer(container)).toEqual({
      isValid: true,
      missingFields: [],
      invalidCount: 0,
    });
  });

  it('flags a contact missing name and phone with 1-based index', () => {
    const container = makeContainer([makeContact()]);
    const result = validateContactDraftsContainer(container);
    expect(result.isValid).toBe(false);
    expect(result.invalidCount).toBe(1);
    expect(result.missingFields).toEqual(['Contact #1 Name', 'Contact #1 Phone']);
  });

  it('counts only invalid contacts and indexes them correctly', () => {
    const container = makeContainer([
      makeContact({ name: 'Ravi', phone: '9876543210' }),
      makeContact({ name: 'Priya' }), // missing phone
    ]);
    const result = validateContactDraftsContainer(container);
    expect(result.invalidCount).toBe(1);
    expect(result.missingFields).toEqual(['Contact #2 Phone']);
  });
});

describe('formatDraftPreviewMessage', () => {
  it('shows Price for a sale draft and hides the rent block', () => {
    const draft = makeDraft({ title: 'HSR 3BHK', price: 15000000, location: 'HSR Layout', type: 'Flat/ Apartment' });
    const msg = formatDraftPreviewMessage('📝 Draft', draft, 'awaiting_confirmation', []);
    expect(msg).toContain('*Price:* ₹1,50,00,000');
    expect(msg).not.toContain('*Maintenance:*');
    expect(msg).toContain('*Beds/Baths:*');
  });

  it('shows the rent block for a rent draft', () => {
    const draft = makeDraft({
      title: 'Rent flat',
      listing_type: 'Rent',
      rent_per_month: 35000,
      maintenance: 2000,
      location: 'HSR',
      type: 'Flat/ Apartment',
    });
    const msg = formatDraftPreviewMessage('📝 Draft', draft, 'awaiting_confirmation', []);
    expect(msg).toContain('*Rent:* ₹35,000/month');
    expect(msg).toContain('*Maintenance:* ₹2,000/month');
    expect(msg).not.toContain('*Price:*');
  });

  it('renders GST ≤ 100 as a percentage and > 100 as rupees', () => {
    const pct = formatDraftPreviewMessage('h', makeDraft({ listing_type: 'Rent', rent_per_month: 1, gst: 18 }), 'collecting', []);
    expect(pct).toContain('*GST:* 18%');
    const rupees = formatDraftPreviewMessage('h', makeDraft({ listing_type: 'Rent', rent_per_month: 1, gst: 5000 }), 'collecting', []);
    expect(rupees).toContain('*GST:* ₹5,000');
  });

  it('hides Beds/Baths for commercial and land types', () => {
    const land = makeDraft({ title: 'Plot', price: 5000000, location: 'x', type: 'Residential Land/ Plot' });
    expect(formatDraftPreviewMessage('h', land, 'awaiting_confirmation', [])).not.toContain('*Beds/Baths:*');
    const comm = makeDraft({ title: 'Shop', price: 5000000, location: 'x', type: 'Commercial Shop' });
    expect(formatDraftPreviewMessage('h', comm, 'awaiting_confirmation', [])).not.toContain('*Beds/Baths:*');
  });

  it('renders the confirm footer when awaiting_confirmation', () => {
    const msg = formatDraftPreviewMessage('h', makeDraft({ title: 't', price: 1, location: 'l' }), 'awaiting_confirmation', []);
    expect(msg).toContain('All mandatory fields populated');
  });

  it('renders the missing-fields footer when collecting', () => {
    const msg = formatDraftPreviewMessage('h', makeDraft(), 'collecting', ['Title', 'Price', 'Location']);
    expect(msg).toContain('*Still missing:* Title, Price, Location');
  });

  it('reports the attached image count', () => {
    const draft = makeDraft({ title: 't', price: 1, location: 'l', images: ['a.jpg', 'b.jpg'] });
    expect(formatDraftPreviewMessage('h', draft, 'awaiting_confirmation', [])).toContain('*Images:* 2 attached');
  });

  it('includes the listing owner/agent line with phone and role', () => {
    const draft = makeDraft({
      title: 't', price: 1, location: 'l',
      owner_contact_name: 'Sridhar', owner_contact_phone: '9999900000', owner_contact_role: 'Agent',
    });
    expect(formatDraftPreviewMessage('h', draft, 'awaiting_confirmation', [])).toContain('*Listing Owner/Agent:* Sridhar (9999900000) [Agent]');
  });
});

describe('formatContactDraftsPreview', () => {
  it('renders each contact with a 1-based index and the confirm footer', () => {
    const container = makeContainer([
      makeContact({ name: 'Ravi', phone: '9876543210', classification: 'Buyer' }),
    ]);
    const msg = formatContactDraftsPreview('📝 Drafts', container, 'awaiting_confirmation', []);
    expect(msg).toContain('*Contact #1:*');
    expect(msg).toContain('• *Name:* Ravi');
    expect(msg).toContain('• *Phone:* 9876543210');
    expect(msg).toContain('• *Role/Classification:* Buyer');
    expect(msg).toContain('All mandatory fields populated for *1* contact(s)!');
  });

  it('marks missing name and phone', () => {
    const container = makeContainer([makeContact()]);
    const msg = formatContactDraftsPreview('h', container, 'collecting', ['Contact #1 Name', 'Contact #1 Phone']);
    expect(msg).toContain('• *Name:* ❓ _Missing_');
    expect(msg).toContain('• *Phone:* ❓ _Missing_');
    expect(msg).toContain('*Still missing:* Contact #1 Name, Contact #1 Phone');
  });

  it('renders the empty-container fallback', () => {
    const msg = formatContactDraftsPreview('h', makeContainer([]), 'collecting', ['No contacts found']);
    expect(msg).toContain('_No contacts parsed._');
  });

  it('injects an index-aligned duplicate warning and skips null entries', () => {
    const container = makeContainer([
      makeContact({ name: 'Ravi', phone: '9876543210' }),
      makeContact({ name: 'Priya', phone: '9000000000' }),
    ]);
    const warnings = [null, '\n⚠️ *The contact with phone number 9000000000 already exists as "Priya S". Please type different number and try again.*'];
    const msg = formatContactDraftsPreview('h', container, 'awaiting_confirmation', [], warnings);
    expect(msg).toContain('already exists as "Priya S"');
    // The first contact has no warning line
    const firstBlock = msg.split('*Contact #2:*')[0];
    expect(firstBlock).not.toContain('already exists');
  });

  it('shows the referrer line only when a referrer name is present', () => {
    const withRef = makeContainer([makeContact({ name: 'A', phone: '1', referrer_name: 'Mahesh', referrer_phone: '5551212' })]);
    expect(formatContactDraftsPreview('h', withRef, 'awaiting_confirmation', [])).toContain('• *Referrer:* Mahesh (5551212)');
    const noRef = makeContainer([makeContact({ name: 'A', phone: '1' })]);
    expect(formatContactDraftsPreview('h', noRef, 'awaiting_confirmation', [])).not.toContain('*Referrer:*');
  });
});
