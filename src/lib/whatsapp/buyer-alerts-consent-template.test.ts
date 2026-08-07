import { describe, it, expect } from 'vitest';
import {
  buildBuyerAlertsConsentParams,
  buildBuyerAlertsConsentTemplatePayload,
  BUYER_ALERTS_CONSENT_TEMPLATE_NAME,
  BUYER_ALERTS_START_BUTTON,
  BUYER_ALERTS_STOP_BUTTON,
} from './buyer-alerts-consent-template';
import { validateTemplatePayload } from './template-validators';
import { parseBuyerAlertsCommand } from '@/lib/buyer/alerts';

describe('buildBuyerAlertsConsentTemplatePayload', () => {
  it('passes the same validator the submit API runs', () => {
    const payload = buildBuyerAlertsConsentTemplatePayload();
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(BUYER_ALERTS_CONSENT_TEMPLATE_NAME);
  });

  it('is Utility, because Marketing is what Meta frequency-caps', () => {
    expect(buildBuyerAlertsConsentTemplatePayload().category).toBe('Utility');
  });

  it('names no listing and makes no offer — it only asks a preference', () => {
    const payload = buildBuyerAlertsConsentTemplatePayload();
    const everything = [
      payload.body_text,
      ...(payload.buttons ?? []).map((b) => b.text),
    ].join('\n');
    expect(everything).not.toMatch(
      /site visit|book|offer|discount|exclusive|premium|₹|don'?t miss/i,
    );
    expect(payload.body_text).toMatch(/requirement/i);
  });

  it('uses button texts the inbox consent parser already understands', () => {
    // The webhook feeds message.button.text through
    // parseBuyerAlertsCommand — a tap and a typed reply must land in
    // the same handler, so these two must stay parseable.
    const payload = buildBuyerAlertsConsentTemplatePayload();
    const texts = (payload.buttons ?? []).map((b) => b.text);
    expect(texts).toEqual([BUYER_ALERTS_START_BUTTON, BUYER_ALERTS_STOP_BUTTON]);
    expect(parseBuyerAlertsCommand(BUYER_ALERTS_START_BUTTON)).toBe('start');
    expect(parseBuyerAlertsCommand(BUYER_ALERTS_STOP_BUTTON)).toBe('stop');
  });
});

describe('buildBuyerAlertsConsentParams', () => {
  it('uses the first name and the agency', () => {
    expect(buildBuyerAlertsConsentParams('Gopi Krishnan', 'Aryavart Ventures')).toEqual([
      'Gopi',
      'Aryavart Ventures',
    ]);
  });

  it('never addresses a portal placeholder by its filing name', () => {
    const [name] = buildBuyerAlertsConsentParams('Housing Lead', 'Acme');
    expect(name).toBe('there');
  });

  it('never returns empty params', () => {
    const params = buildBuyerAlertsConsentParams(undefined, '   ');
    for (const p of params) expect(p.length).toBeGreaterThan(0);
  });
});
