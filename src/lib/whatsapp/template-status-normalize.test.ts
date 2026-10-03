import { describe, expect, it } from 'vitest';
import {
  clearedTemplateComplaints,
  normalizeStatus,
} from './template-status-normalize';

describe('normalizeStatus', () => {
  it('passes through known Meta statuses verbatim', () => {
    expect(normalizeStatus('APPROVED')).toBe('APPROVED');
    expect(normalizeStatus('PAUSED')).toBe('PAUSED');
    expect(normalizeStatus('IN_APPEAL')).toBe('IN_APPEAL');
  });
  it('uppercases lowercase input', () => {
    expect(normalizeStatus('approved')).toBe('APPROVED');
  });
  it('maps PENDING_REVIEW → PENDING', () => {
    expect(normalizeStatus('PENDING_REVIEW')).toBe('PENDING');
  });
  it('falls back to PENDING for unknown values (so the row is still visible)', () => {
    expect(normalizeStatus('SOMETHING_NEW')).toBe('PENDING');
    expect(normalizeStatus('')).toBe('PENDING');
  });
});

describe('clearedTemplateComplaints', () => {
  it('retires a stale submit error once Meta reports the template approved', () => {
    // The bug this exists for: a refused EDIT ("You cannot update an
    // approved template category") wrote submission_error onto an
    // APPROVED row, and nothing could clear it — so a template sending
    // fine showed a red banner indefinitely.
    expect(clearedTemplateComplaints('APPROVED')).toEqual({
      submission_error: null,
      rejection_reason: null,
    });
  });

  it('keeps Meta\'s rejection reason while Meta still calls it rejected', () => {
    const patch = clearedTemplateComplaints('REJECTED');
    expect(patch.submission_error).toBeNull();
    expect('rejection_reason' in patch).toBe(false);
  });

  it('records the reason a sync reads from Meta, so a missed webhook still says why', () => {
    expect(clearedTemplateComplaints('REJECTED', 'INCORRECT_CATEGORY')).toEqual({
      submission_error: null,
      rejection_reason: 'INCORRECT_CATEGORY',
    });
  });

  it('records nothing for Meta\'s NONE placeholder or a blank reason', () => {
    for (const reason of ['NONE', 'none', '  ', null, undefined]) {
      expect('rejection_reason' in clearedTemplateComplaints('REJECTED', reason)).toBe(false);
    }
  });

  it('ignores a reason Meta still reports once the template is no longer rejected', () => {
    expect(clearedTemplateComplaints('APPROVED', 'INCORRECT_CATEGORY').rejection_reason).toBeNull();
  });

  it('clears both once a rejected template is resubmitted and pending again', () => {
    expect(clearedTemplateComplaints('PENDING')).toEqual({
      submission_error: null,
      rejection_reason: null,
    });
  });

  it('clears on the statuses that are not a verdict against the content', () => {
    for (const status of ['PAUSED', 'DISABLED', 'IN_APPEAL'] as const) {
      expect(clearedTemplateComplaints(status).rejection_reason, status).toBeNull();
    }
  });
});
