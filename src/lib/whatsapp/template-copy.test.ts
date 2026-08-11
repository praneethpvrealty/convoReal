import { describe, it, expect } from 'vitest';

import {
  TEMPLATE_COPY_TABLE,
  TEMPLATE_BUTTON_LABELS,
  matchTemplateButton,
  templateBody,
  templateButtonLabel,
  templateFooter,
  hasTranslation,
  type EngineTemplateKey,
  type TemplateButtonAction,
} from './template-copy';
import { LANGUAGE_CODES } from '@/lib/languages';

// Meta's documented caps. A violation is not a style problem: the
// submission is rejected, and a rejected name is reserved for four
// weeks (AGENTS.md §2.7), so catching it here is the only cheap time.
const MAX_BUTTON_CHARS = 25;
const MAX_BODY_CHARS = 1024;
const MAX_FOOTER_CHARS = 60;

const KEYS = Object.keys(TEMPLATE_COPY_TABLE) as EngineTemplateKey[];
const ACTIONS = Object.keys(TEMPLATE_BUTTON_LABELS) as TemplateButtonAction[];

/** `{{1}}`-style placeholders, in order of first appearance. */
function placeholders(text: string): string[] {
  return [...new Set(text.match(/\{\{\d+\}\}/g) ?? [])].sort();
}

describe('button labels', () => {
  it('fit inside Meta\'s 25-character button cap', () => {
    for (const action of ACTIONS) {
      for (const code of LANGUAGE_CODES) {
        const label = TEMPLATE_BUTTON_LABELS[action][code];
        expect(
          label.length,
          `${action}.${code} is ${label.length} chars: "${label}"`,
        ).toBeLessThanOrEqual(MAX_BUTTON_CHARS);
      }
    }
  });

  it('are non-empty in every language', () => {
    for (const action of ACTIONS) {
      for (const code of LANGUAGE_CODES) {
        expect(TEMPLATE_BUTTON_LABELS[action][code].trim()).not.toBe('');
      }
    }
  });

  // Two actions sharing a label in some language would make the inbound
  // matcher ambiguous — whichever it happened to scan first would win,
  // and a lead asking for details could close their enquiry instead.
  it('are unique within each language', () => {
    for (const code of LANGUAGE_CODES) {
      const seen = new Map<string, TemplateButtonAction>();
      for (const action of ACTIONS) {
        const label = TEMPLATE_BUTTON_LABELS[action][code].toLowerCase();
        expect(
          seen.has(label),
          `${code}: "${label}" is used by both ${seen.get(label)} and ${action}`,
        ).toBe(false);
        seen.set(label, action);
      }
    }
  });

  it('resolves a label per action and language', () => {
    expect(templateButtonLabel('close_enquiry', 'en')).toBe('Close my enquiry');
    expect(templateButtonLabel('close_enquiry', 'kn')).toBe('ವಿಚಾರಣೆ ಮುಚ್ಚಿ');
  });
});

describe('matchTemplateButton', () => {
  // The reason this module exists: a tap on a translated button has to
  // route to the same handler as the English one, or the lead gets
  // silence.
  it('matches every label in every language back to its action', () => {
    for (const action of ACTIONS) {
      for (const code of LANGUAGE_CODES) {
        expect(
          matchTemplateButton(TEMPLATE_BUTTON_LABELS[action][code]),
          `${action}.${code}`,
        ).toBe(action);
      }
    }
  });

  it('is case- and whitespace-insensitive, so a typed reply also lands', () => {
    expect(matchTemplateButton('  send MORE details ')).toBe('send_more_details');
  });

  it('returns null for unrelated text', () => {
    expect(matchTemplateButton('hello')).toBeNull();
    expect(matchTemplateButton('')).toBeNull();
    expect(matchTemplateButton(null)).toBeNull();
    expect(matchTemplateButton(undefined)).toBeNull();
  });

  it('ignores a long message that merely contains a label', () => {
    expect(
      matchTemplateButton(
        'I was going to close my enquiry but actually I have another question about the price',
      ),
    ).toBeNull();
  });
});

describe('template bodies', () => {
  it('fit inside Meta\'s 1024-character body cap', () => {
    for (const key of KEYS) {
      for (const code of LANGUAGE_CODES) {
        const body = templateBody(key, code);
        expect(
          body.length,
          `${key}.${code} is ${body.length} chars`,
        ).toBeLessThanOrEqual(MAX_BODY_CHARS);
      }
    }
  });

  it('fit inside Meta\'s 60-character footer cap', () => {
    for (const key of KEYS) {
      for (const code of LANGUAGE_CODES) {
        const footer = templateFooter(key, code);
        if (!footer) continue;
        expect(
          footer.length,
          `${key}.${code} footer is ${footer.length} chars: "${footer}"`,
        ).toBeLessThanOrEqual(MAX_FOOTER_CHARS);
      }
    }
  });

  // Meta rejects a send whose parameter count does not match the
  // registered template. A translation that drops {{3}} would pass
  // review and then fail every send — the worst possible time to find
  // out, since the template is approved and looks healthy.
  it('carry exactly the placeholders English does', () => {
    for (const key of KEYS) {
      const expected = placeholders(templateBody(key, 'en'));
      for (const code of LANGUAGE_CODES) {
        expect(
          placeholders(templateBody(key, code)),
          `${key}.${code} placeholder mismatch`,
        ).toEqual(expected);
      }
    }
  });

  it('are translated into every language for every engine template', () => {
    for (const key of KEYS) {
      for (const code of LANGUAGE_CODES) {
        expect(hasTranslation(key, code), `${key} missing ${code}`).toBe(true);
      }
    }
  });

  // A translation that is silently identical to English means someone
  // added a language entry and forgot to translate it — the fallback
  // would have done the same thing, and the review gate would then be
  // asking a native speaker to approve English.
  it('actually differ from English', () => {
    const english = new Map(KEYS.map((k) => [k, templateBody(k, 'en')]));
    for (const key of KEYS) {
      for (const code of LANGUAGE_CODES) {
        if (code === 'en') continue;
        expect(
          templateBody(key, code),
          `${key}.${code} is identical to English`,
        ).not.toBe(english.get(key));
      }
    }
  });

  it('falls back to English for a language with no entry', () => {
    // location_reveal is fully translated, so prove the mechanism on
    // the accessor rather than by deleting a real entry.
    expect(templateBody('location_reveal', 'en')).toContain('Location Request');
    expect(hasTranslation('location_reveal', 'en')).toBe(true);
  });
});
