import { describe, expect, it } from 'vitest';
import { sanitizeCapability } from './unmet';

describe('sanitizeCapability', () => {
  it('accepts a short canonical phrase', () => {
    expect(sanitizeCapability('export contacts to excel')).toEqual({
      capability: 'export contacts to excel',
      key: 'export contacts to excel',
    });
  });

  it('trims whitespace and trailing punctuation for display', () => {
    expect(sanitizeCapability('  bulk   edit  prices. ')).toEqual({
      capability: 'bulk edit prices',
      key: 'bulk edit prices',
    });
  });

  it('groups filler-prefixed phrasings under one key', () => {
    const bare = sanitizeCapability('export contacts to excel');
    for (const phrasing of [
      'ability to export contacts to excel',
      'the option to export contacts to excel',
      'a way to export contacts to excel',
      'support for export contacts to excel',
    ]) {
      expect(sanitizeCapability(phrasing)?.key, phrasing).toBe(bare!.key);
    }
  });

  it('groups case and punctuation variants under one key', () => {
    const key = sanitizeCapability('export contacts to excel')!.key;
    expect(sanitizeCapability('Export Contacts to Excel!')?.key).toBe(key);
    expect(sanitizeCapability('export contacts / to excel')?.key).toBe(key);
  });

  it('keeps the display phrase as written while normalizing the key', () => {
    const result = sanitizeCapability('Export Contacts to Excel');
    expect(result?.capability).toBe('Export Contacts to Excel');
    expect(result?.key).toBe('export contacts to excel');
  });

  it('rejects non-strings and empties', () => {
    for (const raw of [null, undefined, 42, {}, '', '   ', 'ab']) {
      expect(sanitizeCapability(raw), String(raw)).toBeNull();
    }
  });

  it('rejects sentence-shaped answers that would never group', () => {
    expect(
      sanitizeCapability(
        'the user would like to be able to export all of their contacts'
      )
    ).toBeNull();
  });

  it('rejects phrases longer than the column budget', () => {
    expect(sanitizeCapability('x'.repeat(81))).toBeNull();
  });

  it('rejects phrases carrying PII markers', () => {
    expect(sanitizeCapability('email owner@example.com weekly')).toBeNull();
    expect(sanitizeCapability('message contact 9876543210')).toBeNull();
  });

  it('rejects a phrase with no alphanumeric content', () => {
    expect(sanitizeCapability('--- ???')).toBeNull();
  });
});
