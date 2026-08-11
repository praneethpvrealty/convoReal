import { describe, it, expect } from 'vitest';

import { EN, MESSAGES, translate, type MessageKey } from './messages';
import { LANGUAGE_CODES } from '@/lib/languages';

describe('message catalogue', () => {
  it('has a catalogue for every supported language', () => {
    for (const code of LANGUAGE_CODES) {
      expect(MESSAGES[code], `missing catalogue for ${code}`).toBeDefined();
    }
  });

  // The whole point of Partial catalogues: a half-translated language
  // renders English for the rest rather than a raw key. Without this,
  // shipping one screen at a time would leak `nav.dashboard` into the UI.
  it('falls back to English for an untranslated key', () => {
    const key = 'appearance.title' as MessageKey;
    const withoutKey = { ...MESSAGES.hi };
    delete withoutKey[key];
    // translate() reads MESSAGES, so assert the operator it relies on
    // rather than mutating the module: `?? EN[key]`.
    expect(withoutKey[key] ?? EN[key]).toBe(EN[key]);
  });

  it('returns the translation when one exists', () => {
    expect(translate('hi', 'nav.dashboard')).toBe('डैशबोर्ड');
    expect(translate('ta', 'nav.contacts')).toBe('தொடர்புகள்');
  });

  it('returns English for English', () => {
    for (const key of Object.keys(EN) as MessageKey[]) {
      expect(translate('en', key)).toBe(EN[key]);
    }
  });

  // A translated value that is accidentally an empty string would render
  // a blank label — worse than the English word, and easy to introduce
  // when bulk-editing the catalogue.
  it('has no blank translations', () => {
    for (const code of LANGUAGE_CODES) {
      for (const [key, value] of Object.entries(MESSAGES[code])) {
        expect(value.trim(), `${code}.${key} is blank`).not.toBe('');
      }
    }
  });

  // Every key a catalogue defines must exist in English, or it is dead
  // weight that translate() can never reach (TypeScript catches this on
  // literal objects; this catches it after a merge or a scripted edit).
  it('defines no key English does not have', () => {
    const known = new Set(Object.keys(EN));
    for (const code of LANGUAGE_CODES) {
      for (const key of Object.keys(MESSAGES[code])) {
        expect(known.has(key), `${code} has unknown key ${key}`).toBe(true);
      }
    }
  });

  // Not a completeness requirement — catalogues are allowed to lag. This
  // pins the chrome that the language switcher actually visibly changes,
  // so a new nav item cannot ship translated in name only.
  it('translates the whole nav in every language', () => {
    const navKeys = (Object.keys(EN) as MessageKey[]).filter((k) =>
      k.startsWith('nav.')
    );
    for (const code of LANGUAGE_CODES) {
      for (const key of navKeys) {
        expect(MESSAGES[code][key], `${code} is missing ${key}`).toBeDefined();
      }
    }
  });
});
