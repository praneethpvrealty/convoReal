import { describe, it, expect } from 'vitest';

import {
  resolveLanguage,
  pickTemplateForLanguage,
  isLanguageFallback,
} from './template-language';

type Row = { id: string; language?: string | null; status?: string | null };

const row = (id: string, language: string | null, status = 'APPROVED'): Row => ({
  id,
  language,
  status,
});

describe('resolveLanguage', () => {
  it('prefers the contact over the account', () => {
    expect(resolveLanguage('ta', 'hi')).toBe('ta');
  });

  it('falls back to the account default when the contact has none', () => {
    expect(resolveLanguage(null, 'kn')).toBe('kn');
    expect(resolveLanguage(undefined, 'kn')).toBe('kn');
  });

  it('falls back to English when neither is set', () => {
    expect(resolveLanguage(null, null)).toBe('en');
  });

  // A stale row, a hand-written SQL insert or a code we later retire
  // must not propagate an unmappable value into a Meta send.
  it('ignores values outside the registry', () => {
    expect(resolveLanguage('klingon', 'mr')).toBe('mr');
    expect(resolveLanguage('klingon', 'elvish')).toBe('en');
  });

  // 'en' on the contact is a choice an agent made; it must override a
  // non-English account default rather than read as "unset".
  it('treats an explicit English contact preference as a choice', () => {
    expect(resolveLanguage('en', 'te')).toBe('en');
  });
});

describe('pickTemplateForLanguage', () => {
  it('returns null for no candidates', () => {
    expect(pickTemplateForLanguage([], 'hi')).toBeNull();
  });

  it('picks the approved row in the wanted language', () => {
    const rows = [row('en', 'en_US'), row('hi', 'hi'), row('ta', 'ta')];
    expect(pickTemplateForLanguage(rows, 'hi')?.id).toBe('hi');
  });

  it('maps our short code to the Meta code', () => {
    // We store 'en'; Meta wants 'en_US'.
    expect(pickTemplateForLanguage([row('a', 'en_US')], 'en')?.id).toBe('a');
  });

  it('falls back to English when the wanted language has no row', () => {
    const rows = [row('en', 'en_US'), row('hi', 'hi')];
    expect(pickTemplateForLanguage(rows, 'ml')?.id).toBe('en');
  });

  it('accepts any English variant as the fallback', () => {
    expect(pickTemplateForLanguage([row('gb', 'en_GB')], 'te')?.id).toBe('gb');
    expect(pickTemplateForLanguage([row('bare', 'en')], 'te')?.id).toBe('bare');
  });

  it('ignores unapproved rows when a language match exists elsewhere', () => {
    const rows = [row('pending-ta', 'ta', 'PENDING'), row('en', 'en_US')];
    expect(pickTemplateForLanguage(rows, 'ta')?.id).toBe('en');
  });

  it('accepts the migration-001 title-case status', () => {
    expect(pickTemplateForLanguage([row('a', 'kn', 'Approved')], 'kn')?.id).toBe('a');
  });

  // Callers pass rows of every status deliberately so they can tell
  // "pending Meta approval" from "never created" — this must not
  // collapse those two states by returning null.
  it('returns the first candidate when nothing is approved', () => {
    const rows = [row('pending', 'hi', 'PENDING'), row('rejected', 'en_US', 'REJECTED')];
    expect(pickTemplateForLanguage(rows, 'hi')?.id).toBe('pending');
  });

  it('preserves caller ordering among equally valid rows', () => {
    const rows = [row('newer', 'hi'), row('older', 'hi')];
    expect(pickTemplateForLanguage(rows, 'hi')?.id).toBe('newer');
  });

  it('tolerates a null language on a row', () => {
    expect(pickTemplateForLanguage([row('a', null)], 'hi')?.id).toBe('a');
  });
});

describe('isLanguageFallback', () => {
  it('is false when the chosen row matches', () => {
    expect(isLanguageFallback(row('a', 'hi'), 'hi')).toBe(false);
    expect(isLanguageFallback(row('a', 'en_US'), 'en')).toBe(false);
  });

  it('is true when the send downgraded to another language', () => {
    expect(isLanguageFallback(row('a', 'en_US'), 'hi')).toBe(true);
  });

  it('is false with no row — a missing template is not a fallback', () => {
    expect(isLanguageFallback(null, 'hi')).toBe(false);
  });
});
