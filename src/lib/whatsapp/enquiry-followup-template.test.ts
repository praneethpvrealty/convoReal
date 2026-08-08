import { describe, it, expect } from 'vitest';
import {
  buildEnquiryFollowupTemplatePayload,
  buildEnquiryFollowupParams,
  ENQUIRY_FOLLOWUP_TEMPLATE_NAME,
  ENQUIRY_FOLLOWUP_UPDATE_BUTTON,
  ENQUIRY_FOLLOWUP_CLOSE_BUTTON,
} from './enquiry-followup-template';
import { validateTemplatePayload } from './template-validators';
import { isPreferenceFlowRequestText } from './preference-flow';

describe('buildEnquiryFollowupTemplatePayload', () => {
  it('produces a payload that passes the same validator the submit API runs', () => {
    const payload = buildEnquiryFollowupTemplatePayload();
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(ENQUIRY_FOLLOWUP_TEMPLATE_NAME);
    expect(payload.category).toBe('Utility');
  });

  it('carries only the two variables a send can always resolve', () => {
    // The greeting name (placeholder-safe) and the brokerage sending
    // it (falls back to the product name) — both always resolve, so a
    // send can never fail on a missing per-contact value.
    const payload = buildEnquiryFollowupTemplatePayload();
    const indices = [...payload.body_text.matchAll(/\{\{(\d+)\}\}/g)].map(
      (m) => m[1]
    );
    expect(indices).toEqual(['1', '2']);
    expect(payload.sample_values?.body).toHaveLength(2);
  });

  it('names the sender in the opening line, not after the ask', () => {
    // The lead has never messaged this number. An anonymous message
    // claiming to know about "your property enquiry" is the shape of a
    // scam, and trust is decided on the first line.
    const first = buildEnquiryFollowupTemplatePayload().body_text.split('\n')[0];
    expect(first).toContain('{{2}}');
  });

  it('the update button routes to the preference flow via its text', () => {
    // Template quick-reply taps arrive as message.button.text — the
    // label must satisfy the matcher that drives its action. The close
    // button is matched exactly against ENQUIRY_FOLLOWUP_CLOSE_BUTTON
    // in the webhook handler.
    expect(isPreferenceFlowRequestText(ENQUIRY_FOLLOWUP_UPDATE_BUTTON)).toBe(
      true
    );
    const texts = (buildEnquiryFollowupTemplatePayload().buttons ?? []).map(
      (b) => ('text' in b ? b.text : '')
    );
    expect(texts).toEqual([
      ENQUIRY_FOLLOWUP_UPDATE_BUTTON,
      ENQUIRY_FOLLOWUP_CLOSE_BUTTON,
    ]);
  });

  it('avoids the marketing-classifier signals that got the previous name reclassified', () => {
    // property_enquiry_followup was submitted as Utility and approved
    // as Marketing: opt-in button, "options"/"deals"/"alerts"
    // vocabulary, and an opt-out footer. None of these may reappear.
    const payload = buildEnquiryFollowupTemplatePayload();
    expect(payload.footer_text).toBeUndefined();
    expect((payload.buttons ?? []).every((b) => b.type === 'QUICK_REPLY')).toBe(
      true
    );
    const rendered = [
      payload.body_text,
      ...(payload.buttons ?? []).map((b) => ('text' in b ? b.text : '')),
    ]
      .join(' ')
      .toLowerCase();
    expect(rendered).not.toMatch(/alert|deal|offer|subscribe|opt.?out|stop/);
  });
});

describe('buildEnquiryFollowupParams', () => {
  it('greets by first name and signs with the brokerage', () => {
    expect(buildEnquiryFollowupParams('Praneeth Kumar', 'Aryavarta Ventures')).toEqual([
      'Praneeth',
      'Aryavarta Ventures',
    ]);
  });

  it('never greets a placeholder or missing name', () => {
    for (const name of ['Housing Lead', null, '  ']) {
      expect(buildEnquiryFollowupParams(name, 'Aryavarta Ventures')[0], String(name)).toBe(
        'there'
      );
    }
  });

  it('signs with the product name rather than sending unsigned', () => {
    // Meta rejects an empty param, and an unsigned message is the
    // problem this revision exists to fix — so a blank account name
    // falls back rather than producing either.
    for (const brand of [undefined, null, '   ']) {
      const [, signature] = buildEnquiryFollowupParams('Praneeth', brand);
      expect(signature.length, String(brand)).toBeGreaterThan(0);
    }
  });
});
