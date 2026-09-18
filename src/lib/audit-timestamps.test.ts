import { describe, expect, it } from 'vitest';
import { formatAuditDate, formatAuditDateTime } from './audit-timestamps';

describe('audit timestamp formatting', () => {
  it('formats compact and detailed timestamps', () => {
    const value = '2026-09-13T09:35:00';

    expect(formatAuditDate(value, 'en-GB')).toBe('13 Sept 2026');
    expect(formatAuditDateTime(value, 'en-GB')).toContain('13 Sept 2026');
    expect(formatAuditDateTime(value, 'en-GB')).toMatch(/\b9:35\b/);
  });

  it('does not render an invalid date', () => {
    expect(formatAuditDate(undefined)).toBe('—');
    expect(formatAuditDateTime('not-a-date')).toBe('—');
  });
});
