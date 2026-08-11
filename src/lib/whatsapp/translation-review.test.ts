import { describe, it, expect } from 'vitest';

import {
  requiresTranslationReview,
  isTranslationReviewed,
} from './translation-review';
import { ENGINE_TEMPLATES } from './engine-templates';
import { LANGUAGE_CODES, metaLanguageCode } from '@/lib/languages';

const ENGINE_NAME = ENGINE_TEMPLATES[0].name;

describe('requiresTranslationReview', () => {
  // English is source copy, not a translation. Gating it would break
  // the one-tap flow every account already relies on.
  it('never gates English, in any of Meta\'s three English codes', () => {
    for (const code of ['en_US', 'en_GB', 'en']) {
      expect(requiresTranslationReview(ENGINE_NAME, code)).toBe(false);
    }
  });

  it('gates every non-English variant of an engine template', () => {
    for (const t of ENGINE_TEMPLATES) {
      for (const code of LANGUAGE_CODES) {
        if (code === 'en') continue;
        expect(
          requiresTranslationReview(t.name, metaLanguageCode(code)),
          `${t.name} / ${code}`,
        ).toBe(true);
      }
    }
  });

  // Someone who typed their own Kannada sentence is already the author
  // and the reviewer; asking them to approve it is friction with no
  // signal in it.
  it('does not gate a template the account wrote itself', () => {
    expect(requiresTranslationReview('my_own_offer_blast', 'kn')).toBe(false);
  });
});

describe('isTranslationReviewed', () => {
  it('is true only with a timestamp', () => {
    expect(isTranslationReviewed({ translation_reviewed_at: '2026-01-01T00:00:00Z' })).toBe(true);
    expect(isTranslationReviewed({ translation_reviewed_at: null })).toBe(false);
    expect(isTranslationReviewed({})).toBe(false);
    expect(isTranslationReviewed(null)).toBe(false);
  });
});
