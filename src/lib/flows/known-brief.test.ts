import { describe, it, expect } from 'vitest';
import { buildKnownBriefNote, knownBriefValue } from './known-brief';
import type { Contact } from '@/types';

function contact(overrides: Partial<Contact>): Contact {
  return { id: 'c1', account_id: 'a1', ...overrides } as Contact;
}

describe('knownBriefValue', () => {
  it('answers budget from the stored preference range', () => {
    const known = knownBriefValue(
      contact({
        pref_budget_min: 10000000,
        pref_budget_max: 20000000,
        pref_listing_types: ['Sale'],
      }),
      'budget',
      'sale'
    );
    expect(known?.value).toBe('₹1 Cr–₹2 Cr');
    expect(known?.label).toContain('Budget');
  });

  it('answers locality from areas of interest, capped at three', () => {
    const known = knownBriefValue(
      contact({
        areas_of_interest: [
          'Whitefield',
          'HSR Layout',
          'Indiranagar',
          'Hebbal',
        ],
      }),
      'locality'
    );
    expect(known?.value).toBe('Whitefield, HSR Layout, Indiranagar');
  });

  it('is null when we hold nothing — the question still gets asked', () => {
    expect(knownBriefValue(contact({}), 'budget', 'sale')).toBeNull();
    expect(knownBriefValue(contact({}), 'locality')).toBeNull();
    expect(knownBriefValue(null, 'budget', 'sale')).toBeNull();
  });

  it('ignores var keys it has no record for', () => {
    expect(
      knownBriefValue(contact({ pref_budget_max: 5000000 }), 'email', 'sale')
    ).toBeNull();
  });
});

describe('buildKnownBriefNote', () => {
  it('states what we hold and invites a correction', () => {
    const note = buildKnownBriefNote([
      'Budget: ₹1 Cr–₹2 Cr',
      'Area: Whitefield',
    ]);
    expect(note).toContain('Budget: ₹1 Cr–₹2 Cr');
    expect(note).toContain('Area: Whitefield');
    expect(note).toMatch(/changed/i);
  });
});

describe("knownBriefValue — budget intent", () => {
  const buyer = contact({
    pref_budget_min: 10000000,
    pref_budget_max: 20000000,
    pref_listing_types: ["Sale"],
  });

  it("never reuses a purchase budget as a monthly rent budget", () => {
    expect(knownBriefValue(buyer, "budget", "rent")).toBeNull();
  });

  it("never reuses a budget when the node states no intent", () => {
    expect(knownBriefValue(buyer, "budget", null)).toBeNull();
  });

  it("reuses a rent budget on the rent branch", () => {
    const renter = contact({
      pref_budget_max: 50000,
      pref_listing_types: ["Rent"],
    });
    expect(knownBriefValue(renter, "budget", "rent")?.value).toBe("₹50,000");
  });

  it("still reuses locality whatever the branch", () => {
    const c = contact({ areas_of_interest: ["Whitefield"] });
    expect(knownBriefValue(c, "locality", "rent")?.value).toBe("Whitefield");
  });
});
