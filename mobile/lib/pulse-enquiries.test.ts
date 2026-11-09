import { describe, expect, it } from 'vitest';
import {
  PULSE_ENQUIRY_KINDS,
  describePulseEnquiry,
  nextPulseEnquiryCursor,
  pulseEnquiryIsHot,
  pulseEnquiryVisitor,
  type PulseEnquiryRow,
} from '@shared/lib/pulse/enquiries';

/**
 * [PLS-009] The mobile Pulse enquiries view reads the same shared rules
 * as web. The fetcher itself needs Supabase, so the test exercises the
 * shared module through the alias the app resolves at runtime.
 */

const row: PulseEnquiryRow = {
  kind: 'rating',
  id: 'r1',
  occurred_at: '2026-11-09T07:28:00Z',
  contact_id: 'c1',
  contact_name: 'Asha Rao',
  contact_phone: '9845012345',
  property_id: 'p1',
  property_title: '45x60 Plot in JP Nagar',
  property_code: 'PROP-2489',
  detail: { rating: 9, miss_reasons: [] },
};

describe('[PLS-009] mobile Pulse enquiries use the shared rules', () => {
  it('describes a row and flags a high rating for follow-up', () => {
    expect(describePulseEnquiry(row)).toBe(
      'Rated 45x60 Plot in JP Nagar 9/10.'
    );
    expect(pulseEnquiryIsHot(row, new Date('2026-11-09T09:00:00Z'))).toBe(true);
    expect(pulseEnquiryIsHot(row, new Date('2026-11-20T09:00:00Z'))).toBe(
      false
    );
    expect(pulseEnquiryVisitor(row)).toEqual({
      label: 'Asha Rao',
      identified: true,
    });
  });

  it('stops paging on a short page and knows every kind', () => {
    expect(nextPulseEnquiryCursor([row])).toBeNull();
    expect(PULSE_ENQUIRY_KINDS).toContain('check_in');
    expect(PULSE_ENQUIRY_KINDS).toHaveLength(7);
  });
});
