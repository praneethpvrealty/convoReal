import { describe, it, expect } from 'vitest';
import {
  istHour,
  isWithinCallWindow,
  nextRecipientStatus,
  parseQualification,
  qualificationTags,
} from './campaigns';

describe('istHour', () => {
  it('converts UTC to IST (+5:30)', () => {
    expect(istHour(new Date('2026-08-14T04:30:00Z'))).toBe(10);
    expect(istHour(new Date('2026-08-14T13:29:00Z'))).toBe(18);
    expect(istHour(new Date('2026-08-14T13:30:00Z'))).toBe(19);
  });

  it('wraps past IST midnight', () => {
    expect(istHour(new Date('2026-08-14T20:00:00Z'))).toBe(1);
  });
});

describe('isWithinCallWindow', () => {
  const tenAmIst = new Date('2026-08-14T04:30:00Z');
  const eightPmIst = new Date('2026-08-14T14:30:00Z');

  it('matches inside [start, end) in IST', () => {
    expect(isWithinCallWindow(tenAmIst, 10, 19)).toBe(true);
    expect(isWithinCallWindow(eightPmIst, 10, 19)).toBe(false);
  });

  it('excludes the end hour', () => {
    const sevenPmIst = new Date('2026-08-14T13:30:00Z');
    expect(isWithinCallWindow(sevenPmIst, 10, 19)).toBe(false);
  });

  it('never matches an inverted or empty window', () => {
    expect(isWithinCallWindow(tenAmIst, 19, 10)).toBe(false);
    expect(isWithinCallWindow(tenAmIst, 10, 10)).toBe(false);
  });
});

describe('nextRecipientStatus', () => {
  it('completes on connected and callback_requested', () => {
    expect(nextRecipientStatus('connected', 1, 3)).toBe('completed');
    expect(nextRecipientStatus('callback_requested', 3, 3)).toBe('completed');
  });

  it('fails a wrong number immediately', () => {
    expect(nextRecipientStatus('wrong_number', 1, 3)).toBe('failed');
  });

  it('requeues unanswered calls until attempts are exhausted', () => {
    expect(nextRecipientStatus('no_answer', 1, 3)).toBe('queued');
    expect(nextRecipientStatus('busy', 2, 3)).toBe('queued');
    expect(nextRecipientStatus('no_answer', 3, 3)).toBe('no_answer');
    expect(nextRecipientStatus('voicemail', 4, 3)).toBe('no_answer');
  });
});

describe('parseQualification', () => {
  it('returns null when absent', () => {
    expect(parseQualification(undefined)).toBeNull();
    expect(parseQualification('yes')).toBeNull();
  });

  it('normalises a full block', () => {
    expect(
      parseQualification({
        budget_confirmed: false,
        stated_budget: 25000000,
        stated_areas: ['HSR Layout', ' HSR Layout ', '', 7],
        wants_alternatives: true,
        do_not_call: false,
      })
    ).toEqual({
      budgetConfirmed: false,
      statedBudget: 25000000,
      statedAreas: ['HSR Layout'],
      wantsAlternatives: true,
      doNotCall: false,
    });
  });

  it('drops invalid budgets and non-boolean flags', () => {
    const q = parseQualification({
      budget_confirmed: 'yes',
      stated_budget: -5,
      do_not_call: 'true',
    });
    expect(q).toEqual({
      budgetConfirmed: null,
      statedBudget: null,
      statedAreas: [],
      wantsAlternatives: null,
      doNotCall: false,
    });
  });
});

describe('qualificationTags', () => {
  it('tags confirmed budgets Qualified and mismatches Budget Mismatch', () => {
    expect(
      qualificationTags({
        budgetConfirmed: true,
        statedBudget: null,
        statedAreas: [],
        wantsAlternatives: null,
        doNotCall: false,
      })
    ).toEqual(['Qualified']);
    expect(
      qualificationTags({
        budgetConfirmed: false,
        statedBudget: 1,
        statedAreas: [],
        wantsAlternatives: null,
        doNotCall: false,
      })
    ).toEqual(['Budget Mismatch']);
    expect(
      qualificationTags({
        budgetConfirmed: null,
        statedBudget: null,
        statedAreas: [],
        wantsAlternatives: null,
        doNotCall: false,
      })
    ).toEqual([]);
  });
});
