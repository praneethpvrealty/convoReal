import { describe, expect, it } from 'vitest';

import {
  countByKind,
  relativeDay,
  sortGaps,
  type ConversationGap,
  type GapKind,
  type GapSeverity,
} from './gaps-feed';

function gap(
  over: Partial<ConversationGap> & {
    id: string;
    kind: GapKind;
    severity: GapSeverity;
  }
): ConversationGap {
  return {
    summary: 'something',
    evidence: 'they said something',
    suggested_action: null,
    occurred_at: '2026-08-19T12:00:00.000Z',
    occurrence_count: 1,
    channel: 'client',
    contact_id: 'c1',
    conversation_id: 'conv1',
    contacts: null,
    ...over,
  };
}

describe('sortGaps', () => {
  it('puts the worst first', () => {
    const sorted = sortGaps([
      gap({ id: 'low', kind: 'bot_handoff', severity: 'low' }),
      gap({ id: 'high', kind: 'unanswered_question', severity: 'high' }),
      gap({ id: 'med', kind: 'untracked_conversation', severity: 'medium' }),
    ]);
    expect(sorted.map((g) => g.id)).toEqual(['high', 'med', 'low']);
  });

  it('breaks a tie on how long it has been outstanding', () => {
    const sorted = sortGaps([
      gap({
        id: 'fresh',
        kind: 'untracked_conversation',
        severity: 'high',
        occurrence_count: 1,
      }),
      gap({
        id: 'stale',
        kind: 'untracked_conversation',
        severity: 'high',
        occurrence_count: 5,
      }),
    ]);
    expect(sorted.map((g) => g.id)).toEqual(['stale', 'fresh']);
  });

  it('does not mutate its input', () => {
    const input = [
      gap({ id: 'low', kind: 'bot_handoff', severity: 'low' }),
      gap({ id: 'high', kind: 'unanswered_question', severity: 'high' }),
    ];
    sortGaps(input);
    expect(input.map((g) => g.id)).toEqual(['low', 'high']);
  });
});

describe('countByKind', () => {
  it('counts each kind once', () => {
    const counts = countByKind([
      gap({ id: '1', kind: 'unanswered_question', severity: 'high' }),
      gap({ id: '2', kind: 'unanswered_question', severity: 'low' }),
      gap({ id: '3', kind: 'untracked_conversation', severity: 'medium' }),
    ]);
    expect(counts).toEqual([
      { kind: 'unanswered_question', count: 2 },
      { kind: 'untracked_conversation', count: 1 },
    ]);
  });

  it('returns nothing for an empty feed', () => {
    expect(countByKind([])).toEqual([]);
  });
});

describe('relativeDay', () => {
  const now = Date.parse('2026-08-20T12:00:00.000Z');

  it('reads hours within the day', () => {
    expect(relativeDay('2026-08-20T03:00:00.000Z', now)).toBe('9h ago');
  });

  it('names yesterday rather than counting hours', () => {
    expect(relativeDay('2026-08-19T12:00:00.000Z', now)).toBe('yesterday');
  });

  it('counts days beyond that', () => {
    expect(relativeDay('2026-08-16T12:00:00.000Z', now)).toBe('4 days ago');
  });

  it('does not throw on an unparseable stamp', () => {
    expect(relativeDay('not-a-date', now)).toBe('');
  });
});
