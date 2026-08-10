import { describe, it, expect } from 'vitest';
import {
  buildJourneyCheckinTemplatePayload,
  buildJourneyCheckinParams,
  JOURNEY_CHECKIN_TEMPLATE_NAME,
  JOURNEY_CHECKIN_KEEP_BUTTON,
  JOURNEY_CHECKIN_CLOSE_BUTTON,
} from './journey-checkin-template';
import { ENQUIRY_NOTICE_CLOSE_BUTTON } from './enquiry-notice-template';
import { validateTemplatePayload } from './template-validators';
import { missingEngineTemplates } from './engine-templates';

const ORIGIN = 'https://acme.convoreal.com';

describe('buildJourneyCheckinTemplatePayload', () => {
  it('produces a payload the submit API accepts, as Utility', () => {
    const payload = buildJourneyCheckinTemplatePayload(ORIGIN);
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(JOURNEY_CHECKIN_TEMPLATE_NAME);
    expect(payload.category).toBe('Utility');
  });

  it('never claims the listing is gone — that is the status template', () => {
    const body = buildJourneyCheckinTemplatePayload(ORIGIN).body_text ?? '';
    expect(body).not.toMatch(/no longer available/i);
    expect(body).toMatch(/still under consideration/i);
  });

  it('avoids the vocabulary that reads as promotional at review', () => {
    const payload = buildJourneyCheckinTemplatePayload(ORIGIN);
    const text = [
      payload.body_text ?? '',
      payload.footer_text ?? '',
      ...(payload.buttons ?? []).map((b) => b.text),
    ].join(' ');
    for (const word of ['options', 'deals', 'offer', 'alerts']) {
      expect(text.toLowerCase()).not.toContain(word);
    }
    expect(payload.footer_text ?? '').toBe('');
  });

  it('carries the listing on a URL button, trailing slashes trimmed', () => {
    const payload = buildJourneyCheckinTemplatePayload(`${ORIGIN}//`);
    const url = (payload.buttons ?? []).find((b) => b.type === 'URL');
    expect(url?.url).toBe(`${ORIGIN}/{{1}}`);
  });

  it('shares the close label with the enquiry templates, so one handler covers all', () => {
    expect(JOURNEY_CHECKIN_CLOSE_BUTTON).toBe(ENQUIRY_NOTICE_CLOSE_BUTTON);
    const labels = (buildJourneyCheckinTemplatePayload(ORIGIN).buttons ?? []).map(
      (b) => b.text,
    );
    expect(labels).toContain(JOURNEY_CHECKIN_KEEP_BUTTON);
    expect(labels).toContain(JOURNEY_CHECKIN_CLOSE_BUTTON);
  });

  it('is offered for one-tap creation when the account has no row', () => {
    expect(missingEngineTemplates([]).map((t) => t.name)).toContain(
      JOURNEY_CHECKIN_TEMPLATE_NAME,
    );
    expect(
      missingEngineTemplates([JOURNEY_CHECKIN_TEMPLATE_NAME]).map((t) => t.name),
    ).not.toContain(JOURNEY_CHECKIN_TEMPLATE_NAME);
  });
});

describe('buildJourneyCheckinParams', () => {
  it('greets by first name and signs with the brokerage', () => {
    expect(
      buildJourneyCheckinParams('Supreeth Kumar', 'Aryavarta Ventures', '3 BHK at Prestige'),
    ).toEqual(['Supreeth', 'Aryavarta Ventures', '3 BHK at Prestige']);
  });

  it('never greets a placeholder lead name, and never sends unsigned', () => {
    const [name, brand] = buildJourneyCheckinParams('Housing Lead', '  ', 'A listing');
    expect(name).toBe('there');
    expect(brand.length).toBeGreaterThan(0);
  });

  it('falls back rather than sending an empty param', () => {
    expect(buildJourneyCheckinParams(null, 'Acme', '   ')[2]).toBe('your enquiry');
  });
});
