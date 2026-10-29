import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  auditDate,
  auditDateTime,
  chatListTime,
  cleanPhoneInput,
  dateOnlyLabel,
  parseDateOnly,
} from './format';

describe('audit timestamps', () => {
  it('formats valid dates for record metadata', () => {
    const value = '2026-09-13T09:35:00.000Z';

    expect(auditDate(value)).toContain('2026');
    expect(auditDateTime(value)).toMatch(/\d{1,2}:\d{2}/);
  });

  it('uses a safe fallback for missing or invalid values', () => {
    expect(auditDate(undefined)).toBe('—');
    expect(auditDateTime('invalid')).toBe('—');
  });
});

describe('parseDateOnly', () => {
  it('reads a date column as the local calendar day it names', () => {
    const d = parseDateOnly('2026-09-14');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(8);
    expect(d?.getDate()).toBe(14);
  });

  it('returns null for an absent or unparseable value', () => {
    expect(parseDateOnly(null)).toBeNull();
    expect(parseDateOnly('')).toBeNull();
    expect(parseDateOnly('not a date')).toBeNull();
  });
});

describe('dateOnlyLabel', () => {
  it('prints the calendar day a date column names', () => {
    const label = dateOnlyLabel('2026-09-14');
    expect(label).toContain('14');
    expect(label).toContain('2026');
    expect(label).toBe(
      new Date(2026, 8, 14).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    );
  });

  it('uses the audit fallback for a missing value', () => {
    expect(dateOnlyLabel(null)).toBe('—');
    expect(dateOnlyLabel('soon')).toBe('—');
  });
});

describe('chatListTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never shows a bare weekday for a future date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 27, 10, 0));
    expect(chatListTime(new Date(2026, 9, 28, 9, 0).toISOString())).toBe(
      'Tomorrow'
    );
    expect(chatListTime(new Date(2026, 10, 16, 9, 0).toISOString())).toBe(
      '16 Nov'
    );
    expect(chatListTime(new Date(2026, 9, 26, 9, 0).toISOString())).toBe(
      'Yesterday'
    );
  });
});

describe('cleanPhoneInput', () => {
  it('[ACC-009] sends the web auth phone for every spelling of one number', () => {
    for (const raw of [
      '9900277111',
      '+91-99002-77111',
      '+91 99002 77111',
      '919900277111',
      '09900277111',
    ]) {
      expect(cleanPhoneInput(raw)).toBe('+919900277111');
    }
    expect(cleanPhoneInput('+1 415 555 2671')).toBe('+14155552671');
    expect(cleanPhoneInput('12345')).toBeNull();
  });
});
