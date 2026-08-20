import { describe, expect, it } from 'vitest';
import { composeDigest, type DigestGap } from './digest';

function gap(over: Partial<DigestGap> = {}): DigestGap {
  return {
    kind: 'unanswered_question',
    severity: 'medium',
    summary: 'Anju asked something 9h ago and got no reply',
    occurrenceCount: 1,
    ...over,
  };
}

describe('composeDigest', () => {
  it('does not send a message on a morning with nothing to say', () => {
    // A digest that arrives every day to report nothing is the one that
    // will also be missed on the morning something is wrong.
    const out = composeDigest({
      gaps: [],
      factsApplied: 0,
      factsProposed: 0,
      threadsAnalyzed: 12,
    });
    expect(out.worthSending).toBe(false);
  });

  it('sends when facts are waiting even with no gaps', () => {
    const out = composeDigest({
      gaps: [],
      factsApplied: 0,
      factsProposed: 3,
      threadsAnalyzed: 12,
    });
    expect(out.worthSending).toBe(true);
    expect(out.body).toContain('3 waiting for your OK');
  });

  it('calls out how many need attention today', () => {
    const out = composeDigest({
      gaps: [gap({ severity: 'high' }), gap({ severity: 'low' })],
      factsApplied: 0,
      factsProposed: 0,
      threadsAnalyzed: 5,
    });
    expect(out.title).toBe('2 gaps from yesterday — 1 need you today');
  });

  it('puts the worst first', () => {
    const out = composeDigest({
      gaps: [
        gap({ severity: 'low', summary: 'low one' }),
        gap({ severity: 'high', summary: 'high one' }),
        gap({ severity: 'medium', summary: 'medium one' }),
      ],
      factsApplied: 0,
      factsProposed: 0,
      threadsAnalyzed: 5,
    });
    const lines = out.body.split('\n');
    expect(lines[0]).toContain('high one');
    expect(lines[1]).toContain('medium one');
    expect(lines[2]).toContain('low one');
  });

  it('ages a gap that has been outstanding for days', () => {
    const out = composeDigest({
      gaps: [gap({ occurrenceCount: 4 })],
      factsApplied: 0,
      factsProposed: 0,
      threadsAnalyzed: 5,
    });
    expect(out.body).toContain('(4 days running)');
  });

  it('summarises the tail rather than listing everything', () => {
    const out = composeDigest({
      gaps: Array.from({ length: 10 }, (_, i) => gap({ summary: `gap ${i}` })),
      factsApplied: 0,
      factsProposed: 0,
      threadsAnalyzed: 20,
    });
    expect(out.body).toContain('…and 4 more');
  });

  it('reports what it filled in as well as what it is asking about', () => {
    const out = composeDigest({
      gaps: [gap()],
      factsApplied: 1,
      factsProposed: 2,
      threadsAnalyzed: 5,
    });
    expect(out.body).toContain('1 detail filled in');
    expect(out.body).toContain('2 waiting for your OK');
  });
});
