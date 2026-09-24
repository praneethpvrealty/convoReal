import { describe, expect, it } from 'vitest';

import {
  FOLLOW_ACCOUNT_DEFAULT_LABEL,
  LANGUAGE_CODES,
  isLanguageCode,
  languageDisplay,
  languageFromDisplay,
} from './contact-languages';

describe('mobile language registry', () => {
  it('[CLG-002] offers the seven product languages and nothing else', () => {
    expect(LANGUAGE_CODES).toEqual(['en', 'hi', 'kn', 'ta', 'te', 'ml', 'mr']);
    expect(isLanguageCode('ta')).toBe(true);
    expect(isLanguageCode('fr')).toBe(false);
    expect(isLanguageCode(null)).toBe(false);
  });

  it('round-trips every picker row back to its code', () => {
    for (const code of LANGUAGE_CODES) {
      expect(languageFromDisplay(languageDisplay(code))).toBe(code);
    }
    expect(languageFromDisplay(FOLLOW_ACCOUNT_DEFAULT_LABEL)).toBeNull();
  });

  it('shows the endonym first for every Indian language', () => {
    expect(languageDisplay('en')).toBe('English');
    expect(languageDisplay('hi')).toBe('हिन्दी (Hindi)');
  });
});
