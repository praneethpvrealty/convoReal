import { describe, expect, it } from 'vitest';

import {
  UI_LANGUAGES,
  UI_MESSAGES,
  normalizeUiLanguage,
  translate,
} from './i18n';

describe('mobile ui catalogue', () => {
  it('covers every language with every key', () => {
    const keys = Object.keys(UI_MESSAGES.en);
    for (const lang of UI_LANGUAGES) {
      for (const key of keys) {
        const value = (UI_MESSAGES[lang] as Record<string, string>)[key];
        expect(value, `${lang}/${key}`).toBeTruthy();
      }
    }
  });

  it('normalizes unknown or missing codes to English', () => {
    expect(normalizeUiLanguage('kn')).toBe('kn');
    expect(normalizeUiLanguage('en')).toBe('en');
    expect(normalizeUiLanguage('fr')).toBe('en');
    expect(normalizeUiLanguage(null)).toBe('en');
    expect(normalizeUiLanguage(undefined)).toBe('en');
  });

  it('translates and falls back to English', () => {
    expect(translate('hi', 'tour.next')).toBe('आगे');
    expect(translate('en', 'copilot.title')).toBe('Helper');
  });
});
