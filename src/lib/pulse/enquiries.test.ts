import { describe, expect, it } from 'vitest';
import {
  PULSE_ENQUIRY_PAGE_SIZE,
  describePulseEnquiry,
  filterPulseEnquiries,
  nextPulseEnquiryCursor,
  pulseEnquiryIsHot,
  pulseEnquiryVisitor,
  tallyPulseEnquiryCounts,
  type PulseEnquiryRow,
} from './enquiries';

function row(overrides: Partial<PulseEnquiryRow>): PulseEnquiryRow {
  return {
    kind: 'enquiry',
    id: 'r1',
    occurred_at: '2026-11-09T07:28:00Z',
    contact_id: null,
    contact_name: null,
    contact_phone: null,
    property_id: 'p1',
    property_title: '45x60 Plot in JP Nagar',
    property_code: 'PROP-2489',
    detail: {},
    ...overrides,
  };
}

describe('[PLS-009] Pulse enquiries feed', () => {
  it('names the contact when known, else the requester, else the guest session', () => {
    expect(
      pulseEnquiryVisitor(
        row({ contact_id: 'c1', contact_name: 'Asha Rao', contact_phone: '98' })
      )
    ).toEqual({ label: 'Asha Rao', identified: true });
    expect(
      pulseEnquiryVisitor(
        row({
          kind: 'location_request',
          detail: { requester_name: 'Ravi', requester_phone: '99000' },
        })
      )
    ).toEqual({ label: 'Ravi', identified: false });
    expect(
      pulseEnquiryVisitor(
        row({ kind: 'rating', detail: { session_key: 'ab12cd34' } })
      )
    ).toEqual({ label: 'Anonymous Guest · ab12cd34', identified: false });
  });

  it('describes every kind of request in the agent’s words', () => {
    expect(
      describePulseEnquiry(row({ detail: { source: 'Website Shortlist' } }))
    ).toBe('Enquired about 45x60 Plot in JP Nagar via Website Shortlist.');
    expect(
      describePulseEnquiry(
        row({ kind: 'location_request', detail: { status: 'approved' } })
      )
    ).toMatch(/exact location .* approved/);
    expect(
      describePulseEnquiry(
        row({ kind: 'document_request', detail: { status: 'pending' } })
      )
    ).toMatch(/documents .* awaiting approval/);
    expect(
      describePulseEnquiry(
        row({
          kind: 'rating',
          detail: { rating: 2, miss_reasons: ['budget', 'size'] },
        })
      )
    ).toBe(
      'Rated 45x60 Plot in JP Nagar 2/10 — missed on budget, size or layout.'
    );
    expect(describePulseEnquiry(row({ kind: 'shortlist' }))).toBe(
      'Shortlisted 45x60 Plot in JP Nagar.'
    );
    expect(
      describePulseEnquiry(
        row({ kind: 'whatsapp_tap', detail: { shortlist: true } })
      )
    ).toMatch(/Sent their shortlist/);
    expect(
      describePulseEnquiry(
        row({ kind: 'check_in', detail: { response: 'Book a visit' } })
      )
    ).toContain('replied "Book a visit"');
    expect(
      describePulseEnquiry(row({ kind: 'check_in', detail: {} }))
    ).toContain('no reply yet');
  });

  it('flags what deserves a follow-up today', () => {
    expect(
      pulseEnquiryIsHot(row({ kind: 'rating', detail: { rating: 9 } }))
    ).toBe(true);
    expect(
      pulseEnquiryIsHot(row({ kind: 'rating', detail: { rating: 2 } }))
    ).toBe(false);
    expect(
      pulseEnquiryIsHot(
        row({ kind: 'location_request', detail: { status: 'approved' } })
      )
    ).toBe(false);
    expect(
      pulseEnquiryIsHot(
        row({ kind: 'location_request', detail: { status: 'pending' } })
      )
    ).toBe(true);
    expect(pulseEnquiryIsHot(row({ kind: 'check_in', detail: {} }))).toBe(
      false
    );
    expect(pulseEnquiryIsHot(row({ kind: 'shortlist' }))).toBe(true);
  });

  it('filters by kind and pages by the last row’s time until a short page arrives', () => {
    const rows = [
      row({ kind: 'rating' }),
      row({ id: 'r2', kind: 'shortlist' }),
    ];
    expect(filterPulseEnquiries(rows, 'shortlist')).toHaveLength(1);
    expect(filterPulseEnquiries(rows, 'all')).toHaveLength(2);
    expect(nextPulseEnquiryCursor(rows)).toBeNull();
    const full = Array.from({ length: PULSE_ENQUIRY_PAGE_SIZE }, (_, i) => ({
      id: `row-${i}`,
      occurred_at: '2026-11-09T07:28:00Z',
    }));
    expect(nextPulseEnquiryCursor(full)).toEqual({
      before: '2026-11-09T07:28:00Z',
      beforeId: `row-${PULSE_ENQUIRY_PAGE_SIZE - 1}`,
    });
  });

  it('tallies the counts for every kind, zero when a kind is missing', () => {
    const counts = tallyPulseEnquiryCounts([
      { kind: 'enquiry', total: '4' },
      { kind: 'rating', total: 2 },
      { kind: 'unknown', total: 9 },
    ]);
    expect(counts.enquiry).toBe(4);
    expect(counts.rating).toBe(2);
    expect(counts.shortlist).toBe(0);
    expect(Object.keys(counts)).toHaveLength(7);
  });
});
