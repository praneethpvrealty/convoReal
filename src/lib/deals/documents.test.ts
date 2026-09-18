import { describe, expect, it } from 'vitest';

import {
  canDeleteDocument,
  canTransitionDocumentStatus,
  documentExpiryState,
  parseDocumentPatch,
} from './documents';

describe('[TXW-007] document lifecycle', () => {
  it('moves forward only', () => {
    expect(canTransitionDocumentStatus(null, 'draft')).toBe(true);
    expect(canTransitionDocumentStatus(null, 'executed')).toBe(true);
    expect(canTransitionDocumentStatus('draft', 'reviewed')).toBe(true);
    expect(canTransitionDocumentStatus('reviewed', 'executed')).toBe(true);
    expect(canTransitionDocumentStatus('approved', 'reviewed')).toBe(false);
    expect(canTransitionDocumentStatus('executed', 'executed')).toBe(false);
  });

  it('supersedes approved and executed papers instead of deleting them', () => {
    expect(canDeleteDocument({ status: null, superseded_by: null })).toBe(true);
    expect(canDeleteDocument({ status: 'draft', superseded_by: null })).toBe(true);
    expect(canDeleteDocument({ status: 'reviewed', superseded_by: null })).toBe(true);
    expect(canDeleteDocument({ status: 'approved', superseded_by: null })).toBe(false);
    expect(canDeleteDocument({ status: 'executed', superseded_by: null })).toBe(false);
    expect(canDeleteDocument({ status: 'draft', superseded_by: 'newer' })).toBe(false);
  });

  it('classifies expiry against a date-only clock', () => {
    const today = new Date('2026-09-18T15:00:00+05:30');
    expect(documentExpiryState(null, today)).toBe('none');
    expect(documentExpiryState('2026-09-17', today)).toBe('expired');
    expect(documentExpiryState('2026-09-18', today)).toBe('expiring');
    expect(documentExpiryState('2026-10-18', today)).toBe('expiring');
    expect(documentExpiryState('2026-10-19', today)).toBe('none');
  });
});

describe('parseDocumentPatch', () => {
  it('accepts status, expiry and supersession', () => {
    expect(
      parseDocumentPatch({ status: 'approved', expires_at: '2027-01-01', superseded_by: ' doc-2 ' })
    ).toEqual({
      ok: true,
      value: { status: 'approved', expires_at: '2027-01-01', superseded_by: 'doc-2' },
    });
    expect(parseDocumentPatch({ expires_at: '' })).toEqual({
      ok: true,
      value: { expires_at: null },
    });
  });

  it('rejects unknown statuses, bad dates and empty patches', () => {
    expect(parseDocumentPatch({ status: 'signed' })).toEqual({
      ok: false,
      error: 'Unknown document status',
    });
    expect(parseDocumentPatch({ expires_at: 'soon' })).toEqual({
      ok: false,
      error: 'expires_at must be YYYY-MM-DD',
    });
    expect(parseDocumentPatch({ superseded_by: '' })).toEqual({
      ok: false,
      error: 'superseded_by must name the replacing document',
    });
    expect(parseDocumentPatch(null)).toEqual({ ok: false, error: 'Nothing to update' });
  });
});
