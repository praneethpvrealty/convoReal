import { describe, expect, it } from 'vitest';

import {
  canDecideLocationRequest,
  locationApprovalStatus,
  splitLocationApprovals,
} from './approval-order';

describe('splitLocationApprovals', () => {
  it('[PRP-069] keeps only pending requests open, decisions first, and tucks closed and approved ones away', () => {
    const rows = [
      { id: 'approved-new', status: 'approved' },
      { id: 'rejected', status: 'rejected' },
      {
        id: 'awaiting',
        status: 'pending',
        pending_consent_contact_name: 'Ravi',
      },
      { id: 'decide-1', status: 'pending', pending_consent_contact_name: null },
      { id: 'approved-old', status: 'approved' },
      { id: 'stalled', status: 'pending', stalled_contact_name: 'Nimmy' },
      { id: 'expired', status: 'expired' },
    ];

    const { open, closed, approved } = splitLocationApprovals(rows);

    expect(open.map((r) => r.id)).toEqual(['decide-1', 'stalled', 'awaiting']);
    expect(closed.map((r) => r.id)).toEqual(['rejected', 'expired']);
    expect(approved.map((r) => r.id)).toEqual(['approved-new', 'approved-old']);
  });

  it('returns empty groups for no rows', () => {
    expect(splitLocationApprovals([])).toEqual({
      open: [],
      closed: [],
      approved: [],
    });
  });
});

describe('locationApprovalStatus', () => {
  it('[PRP-068] names the co-broker who did not reply and leaves the decision with the listing side', () => {
    const row = {
      status: 'pending',
      pending_consent_contact_name: null,
      stalled_contact_name: 'Nimmy',
    };
    expect(locationApprovalStatus(row)).toEqual({
      text: "Nimmy didn't reply — your call",
      tone: 'stalled',
    });
    expect(canDecideLocationRequest(row)).toBe(true);
  });

  it('cannot be decided while a co-broker is still being asked', () => {
    const row = { status: 'pending', pending_consent_contact_name: 'Ravi' };
    expect(locationApprovalStatus(row).text).toBe('Awaiting Ravi');
    expect(canDecideLocationRequest(row)).toBe(false);
  });
});
