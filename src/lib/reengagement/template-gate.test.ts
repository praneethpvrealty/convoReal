import { describe, it, expect } from 'vitest';
import {
  canSendToEveryLead,
  isApprovedButMarketing,
  isTemplateApproved,
  isTemplateUtility,
} from './template-gate';

describe('canSendToEveryLead', () => {
  it('requires Utility as well as APPROVED', () => {
    expect(
      canSendToEveryLead({ status: 'APPROVED', category: 'Utility' })
    ).toBe(true);
    // The trap: Meta approves a failed Utility submission AS Marketing
    // instead of rejecting it, so APPROVED alone means nothing about
    // whether the batch will actually reach everyone.
    expect(
      canSendToEveryLead({ status: 'APPROVED', category: 'Marketing' })
    ).toBe(false);
    expect(canSendToEveryLead({ status: 'PENDING', category: 'Utility' })).toBe(
      false
    );
    expect(
      canSendToEveryLead({ status: 'REJECTED', category: 'Utility' })
    ).toBe(false);
  });

  it('treats a missing row or missing category as unsendable', () => {
    expect(canSendToEveryLead(undefined)).toBe(false);
    expect(canSendToEveryLead(null)).toBe(false);
    expect(canSendToEveryLead({ status: 'APPROVED' })).toBe(false);
    expect(canSendToEveryLead({})).toBe(false);
  });

  it('ignores case on both fields', () => {
    expect(
      canSendToEveryLead({ status: 'approved', category: 'UTILITY' })
    ).toBe(true);
  });
});

describe('isApprovedButMarketing', () => {
  it('flags exactly the reclassified case', () => {
    expect(
      isApprovedButMarketing({ status: 'APPROVED', category: 'Marketing' })
    ).toBe(true);
    expect(
      isApprovedButMarketing({ status: 'APPROVED', category: 'Utility' })
    ).toBe(false);
    // Still pending is not yet a reclassification.
    expect(
      isApprovedButMarketing({ status: 'PENDING', category: 'Marketing' })
    ).toBe(false);
  });
});

describe('isTemplateApproved / isTemplateUtility', () => {
  it('read their own field only', () => {
    expect(
      isTemplateApproved({ status: 'APPROVED', category: 'Marketing' })
    ).toBe(true);
    expect(isTemplateUtility({ status: 'REJECTED', category: 'Utility' })).toBe(
      true
    );
  });
});
