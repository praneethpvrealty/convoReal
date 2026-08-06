import { describe, expect, it } from 'vitest';
import {
  buildExtensionApologyTemplatePayload,
  buildExtensionFallbackText,
  buildExtensionGoodwillTemplatePayload,
  buildExtensionNotificationCopy,
  buildExtensionTemplateParams,
  daysPhrase,
  EXTENSION_APOLOGY_TEMPLATE_NAME,
  EXTENSION_GOODWILL_TEMPLATE_NAME,
  formatAccessDate,
  REASON_SENTENCES,
  sentenceForReason,
  templateForTone,
  templateNameForTone,
  toneForReason,
} from './subscription-extension-template';

const BASE = {
  contactName: 'Gopi Krishna',
  reason: 'outage',
  customerMessage: null,
  days: 7,
  newPeriodEnd: '2026-09-14T00:00:00.000Z',
};

describe('toneForReason', () => {
  it.each([
    ['outage', 'apology'],
    ['degraded_service', 'apology'],
    ['billing_error', 'apology'],
    ['onboarding_delay', 'goodwill'],
    ['support_goodwill', 'goodwill'],
  ] as const)('%s => %s', (reason, tone) => {
    expect(toneForReason(reason)).toBe(tone);
  });

  it('treats an unknown reason as goodwill, never inventing a fault we did not admit', () => {
    expect(toneForReason('something_new')).toBe('goodwill');
  });

  it('routes each tone to its own template', () => {
    expect(templateNameForTone('apology')).toBe(
      EXTENSION_APOLOGY_TEMPLATE_NAME
    );
    expect(templateNameForTone('goodwill')).toBe(
      EXTENSION_GOODWILL_TEMPLATE_NAME
    );
  });

  // Meta keys a template on (name, language) and rejects a mismatch with
  // 132001, which fails the send and silently demotes the notice to the
  // free-form fallback. The send path must address the language the
  // template was actually REGISTERED under.
  it.each([
    ['apology', buildExtensionApologyTemplatePayload()],
    ['goodwill', buildExtensionGoodwillTemplatePayload()],
  ] as const)(
    '%s addresses the same name and language it is registered under',
    (tone, payload) => {
      expect(templateForTone(tone)).toEqual({
        name: payload.name,
        language: payload.language,
      });
    }
  );
});

describe('template payloads', () => {
  it.each([
    ['apology', buildExtensionApologyTemplatePayload()],
    ['goodwill', buildExtensionGoodwillTemplatePayload()],
  ] as const)(
    '%s is Utility so it reaches a closed 24h window',
    (_label, payload) => {
      expect(payload.category).toBe('Utility');
    }
  );

  it.each([
    ['apology', buildExtensionApologyTemplatePayload()],
    ['goodwill', buildExtensionGoodwillTemplatePayload()],
  ] as const)('%s declares exactly the 4 params it uses', (_label, payload) => {
    const placeholders = [...payload.body_text.matchAll(/\{\{(\d+)\}\}/g)].map(
      (m) => m[1]
    );
    expect([...new Set(placeholders)].sort()).toEqual(['1', '2', '3', '4']);
    expect(payload.sample_values?.body).toHaveLength(4);
  });

  it('apology owns the fault; goodwill never claims one', () => {
    expect(buildExtensionApologyTemplatePayload().body_text).toContain(
      'our fault'
    );
    expect(buildExtensionGoodwillTemplatePayload().body_text).not.toContain(
      'fault'
    );
    expect(buildExtensionGoodwillTemplatePayload().body_text).not.toContain(
      'sorry'
    );
  });
});

describe('sentenceForReason', () => {
  it('uses the canned line for a known reason', () => {
    expect(sentenceForReason('outage')).toBe(REASON_SENTENCES.outage);
  });

  it('prefers an admin-written customer message', () => {
    expect(
      sentenceForReason('outage', 'WhatsApp sending was down from 9am to noon.')
    ).toBe('WhatsApp sending was down from 9am to noon.');
  });

  it('ignores a blank or whitespace-only override', () => {
    expect(sentenceForReason('outage', '   ')).toBe(REASON_SENTENCES.outage);
    expect(sentenceForReason('outage', '')).toBe(REASON_SENTENCES.outage);
  });

  it('falls back to a safe line for an unknown reason', () => {
    expect(sentenceForReason('brand_new_reason')).toBe(
      REASON_SENTENCES.support_goodwill
    );
  });
});

describe('buildExtensionTemplateParams', () => {
  it('produces exactly 4 non-empty, newline-free params — Meta rejects both', () => {
    const params = buildExtensionTemplateParams({
      ...BASE,
      customerMessage: 'Line one.\nLine two.\n\nLine three.',
    });
    expect(params).toHaveLength(4);
    for (const p of params) {
      expect(p.length).toBeGreaterThan(0);
      expect(p).not.toMatch(/[\n\t]/);
    }
  });

  it('greets on first name only', () => {
    expect(buildExtensionTemplateParams(BASE)[0]).toBe('Gopi');
  });

  it.each([[null], [undefined], ['   ']])(
    'falls back to "there" for name %s',
    (name) => {
      expect(
        buildExtensionTemplateParams({ ...BASE, contactName: name })[0]
      ).toBe('there');
    }
  );

  it('carries the day count and access date', () => {
    const [, , days, until] = buildExtensionTemplateParams(BASE);
    expect(days).toBe('7 days');
    expect(until).toContain('2026');
  });
});

describe('daysPhrase / formatAccessDate', () => {
  it('singularizes one day', () => {
    expect(daysPhrase(1)).toBe('1 day');
    expect(daysPhrase(2)).toBe('2 days');
  });

  it.each([[null], [undefined], ['garbage']])(
    'degrades to a truthful phrase when the date is %s',
    (value) => {
      expect(formatAccessDate(value as string | null)).toBe(
        'your next renewal'
      );
    }
  );
});

describe('buildExtensionFallbackText', () => {
  it('apologises and owns it for our-fault reasons', () => {
    const text = buildExtensionFallbackText(BASE);
    expect(text).toContain('we owe you an apology');
    expect(text).toContain('our fault');
    expect(text).toContain('7 days');
  });

  it('stays warm without apologising for a goodwill gesture', () => {
    const text = buildExtensionFallbackText({
      ...BASE,
      reason: 'support_goodwill',
    });
    expect(text).not.toContain('apology');
    expect(text).not.toContain('fault');
    expect(text).toContain('at no charge');
  });

  it('says the same things as the template body, so a failed template send is not a colder message', () => {
    const [, what, days, until] = buildExtensionTemplateParams(BASE);
    const text = buildExtensionFallbackText(BASE);
    expect(text).toContain(what);
    expect(text).toContain(days);
    expect(text).toContain(until);
  });

  it('uses the admin override verbatim', () => {
    const text = buildExtensionFallbackText({
      ...BASE,
      customerMessage: 'Our servers in Mumbai were unreachable for four hours.',
    });
    expect(text).toContain(
      'Our servers in Mumbai were unreachable for four hours.'
    );
  });
});

describe('buildExtensionNotificationCopy', () => {
  it('names the credit in the title and the reason in the body', () => {
    const copy = buildExtensionNotificationCopy(BASE);
    expect(copy.title).toContain('7 days');
    expect(copy.body).toContain(REASON_SENTENCES.outage);
    expect(copy.body).toContain('Your access now runs to');
  });

  it('does not claim a fault for a goodwill grant', () => {
    const copy = buildExtensionNotificationCopy({
      ...BASE,
      reason: 'support_goodwill',
    });
    expect(`${copy.title} ${copy.body}`).not.toContain('sorry');
  });
});
