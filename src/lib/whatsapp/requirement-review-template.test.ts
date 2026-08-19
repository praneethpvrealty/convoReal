import { describe, expect, it } from 'vitest';

import { isPreferenceFlowRequestText } from './preference-flow';
import {
  buildRequirementReviewParams,
  buildRequirementReviewTemplatePayload,
  REQUIREMENT_REVIEW_BUTTON,
  REQUIREMENT_REVIEW_TEMPLATE_NAME,
} from './requirement-review-template';
import { validateTemplatePayload } from './template-validators';

describe('requirement review template', () => {
  it('is a valid Utility template with one preference-flow reply', () => {
    const payload = buildRequirementReviewTemplatePayload();

    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(REQUIREMENT_REVIEW_TEMPLATE_NAME);
    expect(payload.category).toBe('Utility');
    expect(payload.buttons).toEqual([
      { type: 'QUICK_REPLY', text: REQUIREMENT_REVIEW_BUTTON },
    ]);
    expect(isPreferenceFlowRequestText(REQUIREMENT_REVIEW_BUTTON)).toBe(true);
  });

  it('describes an existing enquiry record without promotional claims', () => {
    const payload = buildRequirementReviewTemplatePayload();
    const rendered = [
      payload.body_text,
      ...(payload.buttons ?? []).map((button) => button.text),
    ]
      .join(' ')
      .toLowerCase();

    expect(rendered).toContain('enquiry record');
    expect(rendered).not.toMatch(/deal|offer|alert|subscribe|stop|listing/);
  });

  it('builds safe name and brokerage parameters', () => {
    expect(
      buildRequirementReviewParams('Praneeth Kumar', 'Aryavarta Ventures')
    ).toEqual(['Praneeth', 'Aryavarta Ventures']);
    expect(buildRequirementReviewParams('Housing Lead', null)[0]).toBe('there');
  });
});
