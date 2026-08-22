import { describe, expect, it } from 'vitest';

import {
  candidateReason,
  distinctiveTerms,
  rankClientCandidates,
  scoreEvidence,
} from './client-candidates';

const contact = (id: string, name: string, phone: string | null = null) => ({
  id,
  name,
  phone,
});

describe('distinctiveTerms', () => {
  it('keeps words that could name one contact', () => {
    const terms = distinctiveTerms(
      'Cancelled the Lodha Sadhahalli booking, asked about Domlur'
    );
    expect(terms).toContain('sadhahalli');
    expect(terms).toContain('domlur');
  });

  it('drops the vocabulary a summariser reaches for', () => {
    const terms = distinctiveTerms(
      'The client wants residential land, direct purchase from owner not developers, budget 8cr'
    );
    for (const generic of [
      'residential',
      'owner',
      'purchase',
      'developers',
      'budget',
      'client',
    ]) {
      expect(terms).not.toContain(generic);
    }
  });
});

describe('scoreEvidence', () => {
  it('lets the phone settle it outright', () => {
    expect(
      scoreEvidence({
        contact: contact('a', 'Someone'),
        matchedTerms: [],
        nameMatched: false,
        phoneMatched: true,
      })
    ).toBe(100);
  });

  it('ranks a name match above a single subject match', () => {
    const byName = scoreEvidence({
      contact: contact('a', 'Natarajan'),
      matchedTerms: [],
      nameMatched: true,
      phoneMatched: false,
    });
    const bySubject = scoreEvidence({
      contact: contact('b', 'Ravi'),
      matchedTerms: ['domlur'],
      nameMatched: false,
      phoneMatched: false,
    });
    expect(byName).toBeGreaterThan(bySubject);
  });

  it('scores nothing when nothing connects the contact to the thread', () => {
    expect(
      scoreEvidence({
        contact: contact('a', 'Ravi'),
        matchedTerms: [],
        nameMatched: false,
        phoneMatched: false,
      })
    ).toBe(0);
  });
});

describe('candidateReason', () => {
  it('names the term the agent will recognise', () => {
    expect(
      candidateReason({
        contact: contact('a', 'Natarajan'),
        matchedTerms: ['domlur'],
        nameMatched: false,
        phoneMatched: false,
      })
    ).toBe('brief mentions Domlur');
  });

  it('is empty when there is nothing to show, so the candidate is dropped', () => {
    expect(
      candidateReason({
        contact: contact('a', 'Ravi'),
        matchedTerms: [],
        nameMatched: false,
        phoneMatched: false,
      })
    ).toBe('');
  });
});

describe('rankClientCandidates', () => {
  it('offers only contacts with a reason to show, best first', () => {
    const ranked = rankClientCandidates([
      {
        contact: contact('a', 'Ravi'),
        matchedTerms: [],
        nameMatched: false,
        phoneMatched: false,
      },
      {
        contact: contact('b', 'Natarajan'),
        matchedTerms: ['domlur'],
        nameMatched: false,
        phoneMatched: false,
      },
      {
        contact: contact('c', 'Suresh'),
        matchedTerms: ['domlur', 'sadhahalli'],
        nameMatched: false,
        phoneMatched: false,
      },
    ]);
    expect(ranked.map((r) => r.contact.id)).toEqual(['c', 'b']);
    expect(ranked[0].reason).toBe('brief mentions Domlur and Sadhahalli');
  });

  it('offers nothing when the book answers nothing', () => {
    expect(
      rankClientCandidates([
        {
          contact: contact('a', 'Ravi'),
          matchedTerms: [],
          nameMatched: false,
          phoneMatched: false,
        },
      ])
    ).toEqual([]);
  });

  it('caps what it offers', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      contact: contact(`x${i}`, `Contact ${i}`),
      matchedTerms: ['domlur'],
      nameMatched: false,
      phoneMatched: false,
    }));
    expect(rankClientCandidates(many)).toHaveLength(3);
  });
});

describe('a note is weaker evidence than a brief', () => {
  it('puts the contact whose own brief names the term first', () => {
    const ranked = rankClientCandidates([
      {
        contact: { id: 'noted', name: 'Rahul', phone: null },
        matchedTerms: [],
        notedTerms: ['domlur'],
        nameMatched: false,
        phoneMatched: false,
      },
      {
        contact: { id: 'brief', name: 'Natarajan', phone: null },
        matchedTerms: ['domlur'],
        notedTerms: [],
        nameMatched: false,
        phoneMatched: false,
      },
    ]);
    expect(ranked.map((r) => r.contact.id)).toEqual(['brief', 'noted']);
    expect(ranked[0].reason).toBe('brief mentions Domlur');
    expect(ranked[1].reason).toBe('a note mentions Domlur');
  });
});
