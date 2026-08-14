import { describe, expect, it } from 'vitest';

import {
  campaignTotals,
  qualificationLabel,
  recipientContact,
  windowLabel,
  type VoiceRecipient,
} from './voice-campaigns';

describe('campaignTotals', () => {
  it('sums all statuses and counts terminal ones as done', () => {
    expect(
      campaignTotals({
        queued: 4,
        calling: 1,
        completed: 3,
        no_answer: 2,
        failed: 1,
        opted_out: 1,
      })
    ).toEqual({ total: 12, done: 7, reached: 3 });
  });

  it('handles an empty campaign', () => {
    expect(campaignTotals({})).toEqual({ total: 0, done: 0, reached: 0 });
  });
});

describe('windowLabel', () => {
  it('zero-pads and marks IST', () => {
    expect(windowLabel(10, 19)).toBe('10:00–19:00 IST');
    expect(windowLabel(9, 21)).toBe('09:00–21:00 IST');
  });
});

describe('qualificationLabel', () => {
  const base = {
    budgetConfirmed: null,
    statedBudget: null,
    statedAreas: [],
    wantsAlternatives: null,
    doNotCall: false,
  };

  it('is null without a signal', () => {
    expect(qualificationLabel(null)).toBeNull();
    expect(qualificationLabel(base)).toBeNull();
  });

  it('labels the outcomes', () => {
    expect(qualificationLabel({ ...base, doNotCall: true })).toBe(
      'Do not call'
    );
    expect(qualificationLabel({ ...base, budgetConfirmed: true })).toBe(
      'Qualified'
    );
    expect(
      qualificationLabel({
        ...base,
        budgetConfirmed: false,
        statedBudget: 25000000,
        statedAreas: ['HSR Layout'],
      })
    ).toBe('Mismatch · ₹2.5 Cr · HSR Layout');
  });
});

describe('recipientContact', () => {
  const contact = { id: 'c1', name: 'Ravi', phone: '9876543210' };
  const row = (c: VoiceRecipient['contact']): VoiceRecipient => ({
    id: 'r1',
    status: 'queued',
    attempts: 0,
    last_attempt_at: null,
    qualification: null,
    contact: c,
  });

  it('normalises object, array and null joins', () => {
    expect(recipientContact(row(contact))).toEqual(contact);
    expect(recipientContact(row([contact]))).toEqual(contact);
    expect(recipientContact(row(null))).toBeNull();
    expect(recipientContact(row([]))).toBeNull();
  });
});
