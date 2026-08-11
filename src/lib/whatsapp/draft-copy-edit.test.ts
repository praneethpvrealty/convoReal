// ============================================================
// The rules a reviewer's correction is held to.
//
// PATCH /api/whatsapp/templates/draft/[id] enforces two things: the
// placeholder SET cannot change, and the result must still pass the
// same validation a submit would. Both are pure and worth pinning —
// the failure mode for either is a template that looks fine, gets
// approved, and then fails every send on a param-count mismatch.
// ============================================================

import { describe, it, expect } from 'vitest';

import { validateTemplatePayload, type TemplatePayload } from './template-validators';
import { templateBody } from './template-copy';

/** Mirrors the route's comparison. */
function placeholders(text: string): string {
  return [...new Set(text.match(/\{\{\d+\}\}/g) ?? [])].sort().join(',');
}

const BASE: TemplatePayload = {
  name: 'listing_details_notice',
  category: 'Utility',
  language: 'kn',
  body_text: templateBody('property_alert', 'kn'),
  sample_values: {
    body: ['Gopi', 'Aryavarta', 'Commercial plot at Hoodi', '32 Cr', 'Hoodi'],
  },
};

const withBody = (body_text: string): TemplatePayload => ({ ...BASE, body_text });

describe('placeholder set guard', () => {
  const original = templateBody('property_alert', 'kn');

  it('accepts a reorder within the sentence', () => {
    // Indic grammar routinely wants the brokerage later or earlier;
    // that must stay allowed or the guard blocks real corrections.
    const moved = original
      .replace('{{2}} ಕಡೆಯಿಂದ ಇಲ್ಲಿವೆ:', 'ಇಲ್ಲಿವೆ, {{2}} ಕಡೆಯಿಂದ:');
    expect(placeholders(moved)).toBe(placeholders(original));
  });

  it('rejects a dropped placeholder', () => {
    expect(placeholders(original.replace('{{5}}', 'Bangalore'))).not.toBe(
      placeholders(original),
    );
  });

  it('rejects an added placeholder', () => {
    expect(placeholders(original + ' {{9}} extra')).not.toBe(placeholders(original));
  });

  it('rejects a renumbered placeholder', () => {
    expect(placeholders(original.replace('{{4}}', '{{7}}'))).not.toBe(
      placeholders(original),
    );
  });

  it('ignores repetition — the same slot twice is still the same set', () => {
    expect(placeholders('a {{1}} b {{1}} c')).toBe('{{1}}');
  });
});

describe('an edited body is held to what a submit is held to', () => {
  it('accepts the shipped wording unchanged', () => {
    expect(() => validateTemplatePayload(BASE)).not.toThrow();
  });

  // The exact mistake the first draft of the translations made, and
  // the one a reviewer rewording an Indic sentence is most likely to
  // reintroduce: word order pulls two slots together.
  it('rejects two placeholders left adjacent', () => {
    expect(() =>
      validateTemplatePayload(
        withBody('ನಮಸ್ಕಾರ {{1}}, {{2}} ವಿವರಗಳು: {{3}} / {{4}} / {{5}} ಉತ್ತರಿಸಿ.'),
      ),
    ).toThrow(/Consecutive variable placeholders/);
  });

  it('rejects a body that opens on a placeholder', () => {
    expect(() =>
      validateTemplatePayload(
        withBody('{{1}} ಅವರೇ, ವಿವರಗಳು {{2}} ಕಡೆಯಿಂದ: {{3}} ಮತ್ತು {{4}} ಹಾಗೂ {{5}} ಇವೆ.'),
      ),
    ).toThrow(/cannot start with a variable/);
  });

  it('rejects a body that ends on a placeholder', () => {
    expect(() =>
      validateTemplatePayload(
        withBody('ನಮಸ್ಕಾರ {{1}}, ವಿವರಗಳು {{2}} ಕಡೆಯಿಂದ ಹೀಗಿವೆ {{3}} ಮತ್ತು {{4}} ಹಾಗೂ {{5}}'),
      ),
    ).toThrow(/cannot end with a variable/);
  });

  it('rejects a body past the 1024-character cap', () => {
    expect(() => validateTemplatePayload(withBody(BASE.body_text + 'ಅ'.repeat(1100)))).toThrow(
      /exceeds 1024/,
    );
  });
});
