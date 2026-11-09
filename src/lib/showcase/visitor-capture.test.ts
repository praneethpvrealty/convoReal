import { describe, expect, it } from 'vitest';
import {
  CAPTURE_AFTER_DISTINCT_VIEWS,
  hasVisitorIdentity,
  shouldOfferBrowsingCapture,
  visitorInquiryMessage,
} from './visitor-capture';

describe('[PRP-058] soft identity capture on the public showcase', () => {
  it('asks an anonymous visitor only once they have opened a second listing', () => {
    const base = { identified: false, dismissed: false, agentMode: false };
    expect(shouldOfferBrowsingCapture({ ...base, distinctViews: 1 })).toBe(
      false
    );
    expect(
      shouldOfferBrowsingCapture({
        ...base,
        distinctViews: CAPTURE_AFTER_DISTINCT_VIEWS,
      })
    ).toBe(true);
  });

  it('never asks an identified visitor, a co-broker view, or after a dismissal', () => {
    const views = { distinctViews: 5 };
    expect(
      shouldOfferBrowsingCapture({
        ...views,
        identified: true,
        dismissed: false,
        agentMode: false,
      })
    ).toBe(false);
    expect(
      shouldOfferBrowsingCapture({
        ...views,
        identified: false,
        dismissed: true,
        agentMode: false,
      })
    ).toBe(false);
    expect(
      shouldOfferBrowsingCapture({
        ...views,
        identified: false,
        dismissed: false,
        agentMode: true,
      })
    ).toBe(false);
  });

  it('tells the agent which moment produced the lead', () => {
    expect(visitorInquiryMessage('high_rating', 9)).toContain('9/10');
    expect(visitorInquiryMessage('quick_interest')).toMatch(/call back/i);
    expect(visitorInquiryMessage('browsing_capture')).toMatch(/browsing/i);
  });

  it('treats a stored name plus a ten-digit number as an identified visitor', () => {
    expect(hasVisitorIdentity('Asha', '98450 12345')).toBe(true);
    expect(hasVisitorIdentity('', '9845012345')).toBe(false);
    expect(hasVisitorIdentity('Asha', '12345')).toBe(false);
  });
});
