import { describe, expect, it } from 'vitest';
import { auditDate, auditDateTime } from './format';

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
