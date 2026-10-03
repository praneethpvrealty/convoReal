import { describe, expect, it } from 'vitest';

import { splitLocationApprovals } from './approval-order';

describe('splitLocationApprovals', () => {
  it('puts your decisions first, then awaiting consent, then closed requests, and sets approved aside', () => {
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
      { id: 'decide-2', status: 'pending' },
      { id: 'expired', status: 'expired' },
    ];

    const { open, approved } = splitLocationApprovals(rows);

    expect(open.map((r) => r.id)).toEqual([
      'decide-1',
      'decide-2',
      'awaiting',
      'rejected',
      'expired',
    ]);
    expect(approved.map((r) => r.id)).toEqual(['approved-new', 'approved-old']);
  });

  it('returns empty groups for no rows', () => {
    expect(splitLocationApprovals([])).toEqual({ open: [], approved: [] });
  });
});
