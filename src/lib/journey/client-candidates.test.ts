import { describe, expect, it } from 'vitest';

import {
  distinctiveTerms,
  rankClientCandidates,
  scoreCandidate,
} from './client-candidates';

const THREAD =
  'I cancelled my Lodha Sadhahalli project booking. Looking for North Bangalore near airport, residential land 1 acre, budget 8cr to 10cr. Only direct purchase not from developers. That Domlur property someone paid advance for 44k it seems';

describe('distinctiveTerms', () => {
  it('keeps the words that could name one contact', () => {
    const terms = distinctiveTerms(THREAD);
    expect(terms).toContain('sadhahalli');
    expect(terms).toContain('domlur');
  });

  it('drops the vocabulary every thread shares', () => {
    const terms = distinctiveTerms(THREAD);
    for (const generic of ['residential', 'property', 'budget', 'looking']) {
      expect(terms).not.toContain(generic);
    }
  });
});

describe('scoreCandidate', () => {
  it('lets the phone settle it outright', () => {
    const { score, reason } = scoreCandidate(
      { clientPhone: '919886217718', threadText: THREAD },
      { id: 'a', name: 'Someone Else', phone: '+91 98862 17718', haystack: '' }
    );
    expect(score).toBe(100);
    expect(reason).toBe('same number as the chat');
  });

  it('ranks a name match above a subject match', () => {
    const byName = scoreCandidate(
      { clientName: 'Natarajan RE', threadText: THREAD },
      { id: 'a', name: 'Natarajan', phone: null, haystack: '' }
    );
    const bySubject = scoreCandidate(
      { clientName: 'Natarajan RE', threadText: THREAD },
      { id: 'b', name: 'Ravi', phone: null, haystack: 'Interested in Domlur' }
    );
    expect(byName.score).toBeGreaterThan(bySubject.score);
    expect(bySubject.reason).toContain('domlur');
  });

  it('scores nothing when the contact answers nothing', () => {
    expect(
      scoreCandidate(
        { clientName: null, threadText: THREAD },
        { id: 'a', name: 'Ravi', phone: null, haystack: 'Wants a shop in HSR' }
      ).score
    ).toBe(0);
  });
});

describe('rankClientCandidates', () => {
  const book = [
    { id: 'a', name: 'Ravi', phone: null, haystack: 'Wants a shop in HSR' },
    {
      id: 'b',
      name: 'Natarajan',
      phone: null,
      haystack: 'Booked at Lodha Sadhahalli last year',
    },
    { id: 'c', name: 'Suresh', phone: null, haystack: 'Looked at Domlur' },
  ];

  it('offers only contacts that matched something, best first', () => {
    const ranked = rankClientCandidates({ threadText: THREAD }, book);
    expect(ranked.map((r) => r.contact.id)).toEqual(['b', 'c']);
  });

  it('caps what it offers', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `x${i}`,
      name: `Contact ${i}`,
      phone: null,
      haystack: 'Lodha Sadhahalli',
    }));
    expect(rankClientCandidates({ threadText: THREAD }, many)).toHaveLength(3);
  });
});
