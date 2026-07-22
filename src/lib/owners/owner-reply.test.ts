import { describe, it, expect } from 'vitest';
import {
  isOwnerContact,
  isTellMeMoreText,
  buildOwnerFallbackReply,
  buildOwnerReplyPrompt,
  type OwnedListing,
} from './owner-reply';
import type { OwnerDigest } from './owner-digest';

function listing(overrides?: Partial<OwnedListing>): OwnedListing {
  return {
    id: 'p1',
    title: '2400 Sq.Ft. Commercial Plot in HSR Sector 2',
    property_code: 'PROP-1006',
    type: 'Commercial Land',
    status: 'Available',
    location: 'HSR Layout, Bangalore',
    sublocality: 'HSR Sector 2',
    city: 'Bangalore',
    is_published: true,
    ...overrides,
  };
}

function digest(overrides?: Partial<OwnerDigest>): OwnerDigest {
  return {
    contactId: 'c1',
    name: 'Umapathy',
    properties: [
      {
        property_id: 'p1',
        title: '2400 Sq.Ft. Commercial Plot in HSR Sector 2',
        inquiries: 2,
        shortlisted: 1,
        visits: 0,
        views: 14,
      },
    ],
    ...overrides,
  };
}

describe('isOwnerContact', () => {
  it('treats owner-ish classifications as owners', () => {
    expect(isOwnerContact({ classification: 'Owner' })).toBe(true);
    expect(isOwnerContact({ classification: 'Seller' })).toBe(true);
    expect(isOwnerContact({ classification: 'Owner & Buyer' })).toBe(true);
    expect(isOwnerContact({ classification: 'Buyer' })).toBe(false);
    expect(isOwnerContact({ classification: 'Others' })).toBe(false);
    expect(isOwnerContact({})).toBe(false);
  });

  it('ignores the default pending consent but honors explicit decisions', () => {
    // Every contact has owner_digest_consent='pending' by default — that
    // alone must never classify a buyer as an owner.
    expect(
      isOwnerContact({
        classification: 'Buyer',
        owner_digest_consent: 'pending',
      })
    ).toBe(false);
    expect(isOwnerContact({ owner_digest_consent: 'granted' })).toBe(true);
    expect(isOwnerContact({ owner_digest_consent: 'declined' })).toBe(true);
  });

  it('treats digest-targeted contacts as owners', () => {
    expect(
      isOwnerContact({
        classification: 'Others',
        owner_digest_consent: 'pending',
        owner_digest_consent_requested_at: '2026-07-22T04:30:00Z',
      })
    ).toBe(true);
  });
});

describe('isTellMeMoreText', () => {
  it('matches the digest quick reply, case-insensitively', () => {
    expect(isTellMeMoreText('Tell me more')).toBe(true);
    expect(isTellMeMoreText('  tell me more ')).toBe(true);
    expect(isTellMeMoreText('tell me more about buyers')).toBe(false);
    expect(isTellMeMoreText('')).toBe(false);
    expect(isTellMeMoreText(null)).toBe(false);
  });
});

describe('buildOwnerFallbackReply', () => {
  it('names the listing so "which property?" is always answered', () => {
    const msg = buildOwnerFallbackReply('Umapathy G', [listing()], digest());
    expect(msg).toContain('Hi Umapathy');
    expect(msg).toContain('*2400 Sq.Ft. Commercial Plot in HSR Sector 2*');
    expect(msg).toContain('PROP-1006');
    expect(msg).toContain('HSR Sector 2, Bangalore');
    expect(msg).toContain('This week:');
    expect(msg).toContain('START UPDATES');
  });

  it('omits the activity line when there is none and caps the listing list', () => {
    const listings = ['A', 'B', 'C', 'D', 'E'].map((t, i) =>
      listing({ id: `p${i}`, title: t, property_code: null })
    );
    const msg = buildOwnerFallbackReply(null, listings, null);
    expect(msg).toContain('Hi there');
    expect(msg).not.toContain('This week:');
    expect(msg).toContain('…and 2 more.');
  });
});

describe('buildOwnerReplyPrompt', () => {
  it('grounds the AI with listings, activity, consent state and the question', () => {
    const prompt = buildOwnerReplyPrompt(
      'Umapathy',
      [listing()],
      digest(),
      'pending',
      'Which land are you talking about'
    );
    expect(prompt).toContain(
      '"2400 Sq.Ft. Commercial Plot in HSR Sector 2" (code PROP-1006)'
    );
    expect(prompt).toContain(
      '2 new enquiries, 1 buyers shortlisted, 14 showcase views'
    );
    expect(prompt).toContain('subscription: pending');
    expect(prompt).toContain('Which land are you talking about');
  });

  it('states when there is no tracked activity instead of leaving a gap to hallucinate into', () => {
    const prompt = buildOwnerReplyPrompt(
      'U',
      [listing()],
      null,
      'granted',
      'any update?'
    );
    expect(prompt).toContain('No fresh tracked activity this week.');
  });
});
