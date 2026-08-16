import { describe, expect, it } from 'vitest';

import {
  buildPurchaseProgressParams,
  buildPurchaseProgressTemplatePayload,
  pickPurchaseProgressTemplate,
  PURCHASE_PROGRESS_TEMPLATE_NAME,
} from './purchase-progress-template';
import { validateTemplatePayload } from './template-validators';
import { LANGUAGE_CODES } from '@/lib/languages';

// This template exists because every other one in the catalogue tells
// its reader they have an open enquiry awaiting a decision, and one of
// them offered a buyer a week from registration a button that marks
// them dead. These lock the difference.

const ORIGIN = 'https://www.convoreal.com';

describe('buildPurchaseProgressTemplatePayload', () => {
  it('is Utility, and stays a candidate for it', () => {
    const payload = buildPurchaseProgressTemplatePayload(ORIGIN);
    expect(payload.category).toBe('Utility');
    expect(payload.name).toBe(PURCHASE_PROGRESS_TEMPLATE_NAME);
    // Meta reads the wording, not our intent: an opt-out footer, an
    // emoji or a browse-more CTA each push a template to Marketing,
    // and the category is decided once and unfixable (AGENTS.md §2.7).
    expect(payload.footer_text).toBeUndefined();
    expect(payload.body_text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(payload.body_text).not.toMatch(/\b(offer|deal|discount|options)\b/i);
  });

  it('never offers to close anything, in any language', () => {
    for (const language of LANGUAGE_CODES) {
      const payload = buildPurchaseProgressTemplatePayload(ORIGIN, language);
      const labels = (payload.buttons ?? []).map((b) => b.text).join(' | ');
      expect(labels, language).not.toMatch(/close|enquir/i);
      expect(payload.body_text, language).not.toMatch(/enquir/i);
    }
  });

  it('carries two quick replies and no URL button', () => {
    const payload = buildPurchaseProgressTemplatePayload(ORIGIN);
    expect(payload.buttons).toHaveLength(2);
    expect(payload.buttons?.every((b) => b.type === 'QUICK_REPLY')).toBe(true);
  });

  it('passes the submit API validator in every language', () => {
    for (const language of LANGUAGE_CODES) {
      expect(
        () =>
          validateTemplatePayload(
            buildPurchaseProgressTemplatePayload(ORIGIN, language)
          ),
        language
      ).not.toThrow();
    }
  });

  it('names the step it is asking about, so the body is specific', () => {
    const payload = buildPurchaseProgressTemplatePayload(ORIGIN);
    expect(payload.body_text).toContain('{{4}}');
    expect(payload.sample_values?.body?.[3]).toBe('Token & Legal');
  });
});

describe('buildPurchaseProgressParams', () => {
  it('fills all four params from the deal', () => {
    expect(
      buildPurchaseProgressParams(
        'Dr Ravi N',
        'Aryavarta Ventures',
        'Commercial Building, JP Nagar',
        'Token & Legal'
      )
    ).toEqual([
      'Dr',
      'Aryavarta Ventures',
      'Commercial Building, JP Nagar',
      'Token & Legal',
    ]);
  });

  // Meta rejects an empty parameter outright, so every slot has to
  // land on something rather than an empty string.
  it('never emits an empty parameter', () => {
    const params = buildPurchaseProgressParams('Housing Lead', '', '', null);
    expect(params[0]).toBe('there');
    expect(params.every((p) => p.length > 0)).toBe(true);
  });

  it('does not greet a placeholder name as a person', () => {
    expect(buildPurchaseProgressParams('Portal Lead', 'A', 'B', 'C')[0]).toBe(
      'there'
    );
  });
});

describe('pickPurchaseProgressTemplate', () => {
  it('takes the approved row and ignores anything else', () => {
    const picked = pickPurchaseProgressTemplate([
      { name: PURCHASE_PROGRESS_TEMPLATE_NAME, status: 'PENDING' },
      { name: PURCHASE_PROGRESS_TEMPLATE_NAME, status: 'APPROVED' },
    ]);
    expect(picked?.status).toBe('APPROVED');
  });

  it('returns null when the account has not had it approved', () => {
    expect(
      pickPurchaseProgressTemplate([
        { name: PURCHASE_PROGRESS_TEMPLATE_NAME, status: 'REJECTED' },
      ])
    ).toBeNull();
  });
});
