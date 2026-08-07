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

  it('uses a single body variable so a send never fails on missing contact data', () => {
    const payload = buildEnquiryFollowupTemplatePayload();
    const indices = [...payload.body_text.matchAll(/\{\{(\d+)\}\}/g)].map(
      (m) => m[1]
    );
    expect(indices).toEqual(['1']);
    expect(payload.sample_values?.body).toHaveLength(1);
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
  it('greets by first name', () => {
    expect(buildEnquiryFollowupParams('Praneeth Kumar')).toEqual(['Praneeth']);
  });

  it('never greets a placeholder or missing name', () => {
    expect(buildEnquiryFollowupParams('Housing Lead')).toEqual(['there']);
    expect(buildEnquiryFollowupParams(null)).toEqual(['there']);
    expect(buildEnquiryFollowupParams('  ')).toEqual(['there']);
  });
});
