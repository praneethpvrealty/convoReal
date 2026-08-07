import { describe, it, expect } from 'vitest';
import {
  buildEnquiryFollowupTemplatePayload,
  buildEnquiryFollowupParams,
  ENQUIRY_FOLLOWUP_TEMPLATE_NAME,
  ENQUIRY_FOLLOWUP_UPDATE_BUTTON,
  ENQUIRY_FOLLOWUP_SUBSCRIBE_BUTTON,
  ENQUIRY_FOLLOWUP_STOP_BUTTON,
} from './enquiry-followup-template';
import { validateTemplatePayload } from './template-validators';
import { isPreferenceFlowRequestText } from './preference-flow';
import { parseBuyerAlertsCommand } from '@/lib/buyer/alerts';

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

  it('every button tap routes to a webhook action via its text', () => {
    // Template quick-reply taps arrive as message.button.text — each
    // label must satisfy the parser that drives its action.
    expect(isPreferenceFlowRequestText(ENQUIRY_FOLLOWUP_UPDATE_BUTTON)).toBe(
      true
    );
    expect(parseBuyerAlertsCommand(ENQUIRY_FOLLOWUP_SUBSCRIBE_BUTTON)).toBe(
      'start'
    );
    expect(parseBuyerAlertsCommand(ENQUIRY_FOLLOWUP_STOP_BUTTON)).toBe('stop');
  });

  it('carries quick replies only — no URL/CTA button to trip the utility classifier', () => {
    const payload = buildEnquiryFollowupTemplatePayload();
    expect((payload.buttons ?? []).every((b) => b.type === 'QUICK_REPLY')).toBe(
      true
    );
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
