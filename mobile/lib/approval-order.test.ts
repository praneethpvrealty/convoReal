import { describe, expect, it } from 'vitest';

import { splitLocationApprovals } from './approval-order';

describe('location approvals order on mobile', () => {
  it('lists pending decisions first and sets approved requests aside', () => {
    const { open, approved } = splitLocationApprovals([
      { id: 'a', status: 'approved' },
      { id: 'w', status: 'pending', pending_consent_contact_name: 'Ravi' },
      { id: 'p', status: 'pending', pending_consent_contact_name: null },
      { id: 'r', status: 'rejected' },
    ]);
    expect(open.map((r) => r.id)).toEqual(['p', 'w', 'r']);
    expect(approved.map((r) => r.id)).toEqual(['a']);
  });
});
