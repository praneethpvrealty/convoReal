import { describe, expect, it } from 'vitest';

import {
  existingContactIdFrom,
  importSummary,
  isDuplicatePhone,
} from './duplicate-phone';

describe('existingContactIdFrom', () => {
  it('[CTM-018] reads the saved contact a duplicate-number refusal points at', () => {
    expect(
      existingContactIdFrom({ code: 'DUPLICATE_PHONE', data: { id: 'c-1' } })
    ).toBe('c-1');
  });

  it('[CTM-018] ignores every other refusal', () => {
    expect(
      existingContactIdFrom({
        code: 'DUPLICATE_FULL_NAME',
        data: { id: 'c-1' },
      })
    ).toBeNull();
    expect(existingContactIdFrom({ code: 'DUPLICATE_PHONE' })).toBeNull();
    expect(existingContactIdFrom(new Error('boom'))).toBeNull();
    expect(existingContactIdFrom(null)).toBeNull();
  });
});

describe('isDuplicatePhone', () => {
  it('[CTM-018] recognises a duplicate refusal that withholds the contact id', () => {
    expect(isDuplicatePhone({ code: 'DUPLICATE_PHONE' })).toBe(true);
    expect(existingContactIdFrom({ code: 'DUPLICATE_PHONE' })).toBeNull();
    expect(isDuplicatePhone({ code: 'DUPLICATE_FULL_NAME' })).toBe(false);
    expect(isDuplicatePhone(undefined)).toBe(false);
  });
});

describe('importSummary', () => {
  it('[CTM-018] counts numbers already saved apart from failures', () => {
    expect(
      importSummary({ ok: 2, existing: 1, failed: 0, failureReason: 'x' })
    ).toBe('Imported 2 contacts · 1 already saved');
    expect(
      importSummary({
        ok: 1,
        existing: 0,
        failed: 2,
        failureReason: 'the server did not respond',
      })
    ).toBe('Imported 1 contact · 2 failed (the server did not respond)');
  });
});
