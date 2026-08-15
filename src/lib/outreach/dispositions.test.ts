import { describe, expect, it } from 'vitest';
import {
  DISPOSITIONS,
  isDisposition,
  resolveDisposition,
} from '@/lib/outreach/dispositions';
import type { Qualification } from '@/lib/voice/campaigns';

const qual = (over: Partial<Qualification> = {}): Qualification => ({
  budgetConfirmed: null,
  statedBudget: null,
  statedAreas: [],
  wantsAlternatives: null,
  doNotCall: false,
  ...over,
});

describe('isDisposition', () => {
  it('accepts every member of the closed set', () => {
    for (const d of DISPOSITIONS) expect(isDisposition(d)).toBe(true);
  });

  it('rejects unknown strings and non-strings', () => {
    expect(isDisposition('hot_lead')).toBe(false);
    expect(isDisposition('')).toBe(false);
    expect(isDisposition(null)).toBe(false);
    expect(isDisposition(42)).toBe(false);
  });
});

describe('resolveDisposition', () => {
  it('takes the explicit disposition when it names a known value', () => {
    expect(resolveDisposition('not_now', null)).toBe('not_now');
    expect(resolveDisposition('has_property_to_sell', qual())).toBe(
      'has_property_to_sell'
    );
  });

  it('normalises unknown values to null rather than inventing one', () => {
    expect(resolveDisposition('interested_maybe', null)).toBeNull();
    expect(resolveDisposition(7, null)).toBeNull();
  });

  it('do_not_call overrides whatever the agent labelled the call', () => {
    expect(resolveDisposition('qualified', qual({ doNotCall: true }))).toBe(
      'do_not_call'
    );
  });

  it('derives qualified from a confirmed budget', () => {
    expect(resolveDisposition(null, qual({ budgetConfirmed: true }))).toBe(
      'qualified'
    );
  });

  it('derives open vs closed budget mismatch from wants_alternatives', () => {
    expect(
      resolveDisposition(
        null,
        qual({ budgetConfirmed: false, wantsAlternatives: true })
      )
    ).toBe('budget_mismatch_open');
    // Unstated leans open: showing alternatives is the 95% case.
    expect(resolveDisposition(null, qual({ budgetConfirmed: false }))).toBe(
      'budget_mismatch_open'
    );
    expect(
      resolveDisposition(
        null,
        qual({ budgetConfirmed: false, wantsAlternatives: false })
      )
    ).toBe('budget_mismatch_closed');
  });

  it('returns null when nothing usable was said', () => {
    expect(resolveDisposition(null, null)).toBeNull();
    expect(resolveDisposition(null, qual())).toBeNull();
  });
});
