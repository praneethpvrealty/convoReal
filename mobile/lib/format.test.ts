import { describe, expect, it } from 'vitest';
import { auditDate, auditDateTime, parseDateOnly } from './format';

describe('audit timestamps', () => {
  it('formats valid dates for record metadata', () => {
    const value = '2026-09-13T09:35:00.000Z';

    expect(auditDate(value)).toContain('2026');
    expect(auditDateTime(value)).toContain(':35');
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
