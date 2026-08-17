import { describe, expect, it } from 'vitest';
import {
  buildConsentRequestMessage,
  buildMatchDigestMessage,
  buildNoMatchesMessage,
  buildUnavailableEnquiryMessage,
  parseBuyerMatchesCommand,
  selectUnsentMatches,
  MAX_DIGEST_MATCHES,
} from './digest';
import type { CuratedMatch } from './matches-ranking';
import type { Property } from '@/types';

function match(overrides: Partial<Property>, score = 80, reasons: string[] = []): CuratedMatch {
  return {
    score,
    reasons,
    details: {} as never,
    property: {
      id: overrides.id || 'p1',
      account_id: 'acc',
      user_id: null,
      title: 'Skyline Residences',
      type: 'Flat/Apartment',
      listing_type: 'Sale',
      status: 'Available',
      price: 9_000_000,
      location: 'Bangalore',
      sublocality: 'Whitefield',
      bedrooms: 3,
      area_sqft: 1650,
      ...overrides,
    } as Property,
  };
}

describe('selectUnsentMatches', () => {
  it('drops listings the buyer has already been sent', () => {
    const matches = [match({ id: 'a' }), match({ id: 'b' }), match({ id: 'c' })];
    const kept = selectUnsentMatches(matches, ['b']);
    expect(kept.map((m) => m.property.id)).toEqual(['a', 'c']);
  });

  it('caps the digest', () => {
    const matches = Array.from({ length: 8 }, (_, i) => match({ id: `p${i}` }));
    expect(selectUnsentMatches(matches, [])).toHaveLength(MAX_DIGEST_MATCHES);
  });

  it('returns nothing when everything has been sent', () => {
    const matches = [match({ id: 'a' }), match({ id: 'b' })];
    expect(selectUnsentMatches(matches, ['a', 'b'])).toEqual([]);
  });
});

describe('buildMatchDigestMessage', () => {
  const portalUrl = 'https://convoreal.com/buyer/login?next=/buyer/matches';

  it('leads with the count and lists each match with price and specs', () => {
    const text = buildMatchDigestMessage({
      contactName: 'Ravi Kumar',
      matches: [
        match({ id: 'a' }, 88, ['In your area', 'Within budget']),
        match({ id: 'b', title: 'Palm Grove', price: 42_000_000, sublocality: 'Indiranagar' }, 71),
      ],
      portalUrl,
    });
    expect(text).toContain('Hi Ravi');
    expect(text).toContain('2 new listings');
    expect(text).toContain('*Skyline Residences* — ₹90 L');
    expect(text).toContain('Whitefield · 3 BHK · 1,650 Sq.Ft.');
    expect(text).toContain('✓ In your area · Within budget');
    expect(text).toContain('*Palm Grove* — ₹4.2 Cr');
    expect(text).toContain(portalUrl);
  });

  it('always carries the opt-out', () => {
    const text = buildMatchDigestMessage({
      contactName: null,
      matches: [match({ id: 'a' })],
      portalUrl,
    });
    expect(text).toContain('STOP ALERTS');
  });

  it('speaks in the singular for one match, and greets an unnamed buyer', () => {
    const text = buildMatchDigestMessage({
      contactName: '   ',
      matches: [match({ id: 'a' })],
      portalUrl,
    });
    expect(text).toContain('Hi there');
    expect(text).toContain('One new listing');
  });

  it('prices a rental per month', () => {
    const text = buildMatchDigestMessage({
      contactName: 'Ravi',
      matches: [
        match({ id: 'r', listing_type: 'Rent', rent_per_month: 55_000, price: 0 }),
      ],
      portalUrl,
    });
    expect(text).toContain('₹55,000/month');
  });
});

describe('buildConsentRequestMessage', () => {
  it('asks once, names the agency, and offers both answers', () => {
    const text = buildConsentRequestMessage({
      contactName: 'Ravi Kumar',
      matchCount: 3,
      agencyName: 'PV Realty',
    });
    expect(text).toContain('Hi Ravi');
    expect(text).toContain('from PV Realty');
    expect(text).toContain('3 listings that match');
    expect(text).toContain('START ALERTS');
    expect(text).toContain('STOP ALERTS');
  });

  it('reads naturally with one match and no agency name', () => {
    const text = buildConsentRequestMessage({ contactName: null, matchCount: 1 });
    expect(text).toContain('a listing that matches');
    expect(text).not.toContain('from ');
  });
});

describe('buildNoMatchesMessage', () => {
  it('says nothing fits and invites an update', () => {
    expect(buildNoMatchesMessage('Ravi')).toContain('nothing in our inventory fits');
  });
});

describe('buildUnavailableEnquiryMessage', () => {
  it('names the unavailable enquiry and keeps the requirement active', () => {
    const text = buildUnavailableEnquiryMessage({
      contactName: 'Vinutha',
      propertyTitle: 'Palm Grove',
      hasAlternatives: false,
    });
    expect(text).toContain('*Palm Grove* is no longer available');
    expect(text).toContain('kept your requirement active');
  });

  it('introduces available alternatives when they exist', () => {
    expect(
      buildUnavailableEnquiryMessage({
        contactName: 'Vinutha',
        propertyTitle: 'Palm Grove',
        hasAlternatives: true,
      })
    ).toContain('these available options');
  });
});

describe('parseBuyerMatchesCommand', () => {
  it('recognises how buyers actually ask', () => {
    for (const text of [
      'MATCHES',
      'matches',
      'show matches',
      'my matches',
      'show my matches',
      'any new listings?',
      'send properties',
    ]) {
      expect(parseBuyerMatchesCommand(text), text).toBe(true);
    }
  });

  it('ignores ordinary conversation', () => {
    for (const text of [
      'is the price negotiable?',
      'I want to see the matches you sent last week in Whitefield please',
      'stop alerts',
      '',
      null,
    ]) {
      expect(parseBuyerMatchesCommand(text), String(text)).toBe(false);
    }
  });
});
