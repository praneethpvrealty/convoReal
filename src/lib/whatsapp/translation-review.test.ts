import { describe, it, expect } from 'vitest';

import {
  requiresTranslationReview,
  isTranslationReviewed,
  awaitsTranslationGate,
  editMatchesReviewedCopy,
} from './translation-review';
import { ENGINE_TEMPLATES } from './engine-templates';
import { LANGUAGE_CODES, metaLanguageCode } from '@/lib/languages';

const ENGINE_NAME = ENGINE_TEMPLATES[0].name;

describe('requiresTranslationReview', () => {
  // English is source copy, not a translation. Gating it would break
  // the one-tap flow every account already relies on.
  it("never gates English, in any of Meta's three English codes", () => {
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
          `${t.name} / ${code}`
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
    expect(
      isTranslationReviewed({ translation_reviewed_at: '2026-01-01T00:00:00Z' })
    ).toBe(true);
    expect(isTranslationReviewed({ translation_reviewed_at: null })).toBe(
      false
    );
    expect(isTranslationReviewed({})).toBe(false);
    expect(isTranslationReviewed(null)).toBe(false);
  });
});

describe('awaitsTranslationGate', () => {
  it('[CLG-004] gates a translation draft that has not reached Meta', () => {
    expect(
      awaitsTranslationGate({
        name: ENGINE_NAME,
        language: 'kn',
        meta_template_id: null,
      })
    ).toBe(true);
  });

  it('[CLG-004] lifts the gate while Meta holds the row pending or approved', () => {
    for (const status of ['PENDING', 'APPROVED', 'PAUSED']) {
      expect(
        awaitsTranslationGate({
          name: ENGINE_NAME,
          language: 'kn',
          meta_template_id: '123',
          status,
        }),
        status
      ).toBe(false);
    }
  });

  it('[CLG-004] puts a rejected translation back behind the gate', () => {
    expect(
      awaitsTranslationGate({
        name: ENGINE_NAME,
        language: 'kn',
        meta_template_id: '123',
        status: 'REJECTED',
      })
    ).toBe(true);
    expect(
      awaitsTranslationGate({
        name: ENGINE_NAME,
        language: 'en_US',
        meta_template_id: '123',
        status: 'REJECTED',
      })
    ).toBe(false);
  });

  it('[CLG-004] never gates English or account-authored templates', () => {
    expect(
      awaitsTranslationGate({
        name: ENGINE_NAME,
        language: 'en_US',
        meta_template_id: null,
      })
    ).toBe(false);
    expect(
      awaitsTranslationGate({
        name: ENGINE_NAME,
        language: null,
        meta_template_id: null,
      })
    ).toBe(false);
    expect(
      awaitsTranslationGate({
        name: 'my_own_offer_blast',
        language: 'kn',
        meta_template_id: null,
      })
    ).toBe(false);
  });
});

describe('editMatchesReviewedCopy', () => {
  const reviewed = {
    translation_reviewed_at: '2026-09-22T04:00:00Z',
    body_text: 'ನಮಸ್ಕಾರ {{1}}',
    footer_text: null,
  };

  it('[CLG-004] accepts an edit that carries the signed-off words', () => {
    expect(
      editMatchesReviewedCopy(reviewed, { body_text: 'ನಮಸ್ಕಾರ {{1}}' })
    ).toBe(true);
  });

  it('[CLG-004] refuses an unreviewed row or altered wording', () => {
    expect(
      editMatchesReviewedCopy(
        { ...reviewed, translation_reviewed_at: null },
        { body_text: 'ನಮಸ್ಕಾರ {{1}}' }
      )
    ).toBe(false);
    expect(editMatchesReviewedCopy(reviewed, { body_text: 'ಹಲೋ {{1}}' })).toBe(
      false
    );
    expect(
      editMatchesReviewedCopy(reviewed, {
        body_text: 'ನಮಸ್ಕಾರ {{1}}',
        footer_text: 'STOP',
      })
    ).toBe(false);
  });
});
