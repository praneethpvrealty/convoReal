/**
 * Deal document lifecycle: draft → reviewed → approved → executed.
 *
 * Status only moves forward. A document that is approved or executed
 * is never deleted — it is superseded by a newer upload and kept,
 * marked, so the folder never silently loses the version somebody
 * signed. An unlabelled document (status NULL) is one filed before
 * the lifecycle existed, or one nobody has classified yet.
 */

export type DealDocumentStatus = 'draft' | 'reviewed' | 'approved' | 'executed';

export const DEAL_DOCUMENT_STATUSES: readonly DealDocumentStatus[] = [
  'draft',
  'reviewed',
  'approved',
  'executed',
];

/** Mirrored in mobile/lib/deal-workspace.ts; guarded by mobile-parity.test.ts. */
export const DEAL_DOCUMENT_STATUS_LABELS: Record<DealDocumentStatus, string> = {
  draft: 'Draft',
  reviewed: 'Reviewed',
  approved: 'Approved',
  executed: 'Executed',
};

export function isDealDocumentStatus(v: unknown): v is DealDocumentStatus {
  return (
    typeof v === 'string' &&
    (DEAL_DOCUMENT_STATUSES as readonly string[]).includes(v)
  );
}

export function canTransitionDocumentStatus(
  from: DealDocumentStatus | null,
  to: DealDocumentStatus
): boolean {
  if (from === null) return true;
  return DEAL_DOCUMENT_STATUSES.indexOf(to) > DEAL_DOCUMENT_STATUSES.indexOf(from);
}

/** Approved and executed papers are superseded, never deleted. */
export function canDeleteDocument(doc: {
  status: DealDocumentStatus | null;
  superseded_by: string | null;
}): boolean {
  if (doc.superseded_by) return false;
  return doc.status !== 'approved' && doc.status !== 'executed';
}

export function documentExpiryState(
  expiresAt: string | null,
  today: Date = new Date()
): 'none' | 'expiring' | 'expired' {
  if (!expiresAt) return 'none';
  const expiry = new Date(`${expiresAt}T00:00:00Z`);
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  const days = Math.round((expiry.getTime() - start.getTime()) / 86_400_000);
  if (days < 0) return 'expired';
  if (days <= 30) return 'expiring';
  return 'none';
}

export interface DocumentPatch {
  status?: DealDocumentStatus;
  expires_at?: string | null;
  superseded_by?: string;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function parseDocumentPatch(raw: unknown): ParseResult<DocumentPatch> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Nothing to update' };
  }
  const input = raw as Record<string, unknown>;
  const patch: DocumentPatch = {};

  if (input.status !== undefined) {
    if (!isDealDocumentStatus(input.status)) {
      return { ok: false, error: 'Unknown document status' };
    }
    patch.status = input.status;
  }
  if (input.expires_at !== undefined) {
    const v = input.expires_at;
    if (v === null || v === '') patch.expires_at = null;
    else if (typeof v === 'string' && DATE_ONLY.test(v)) patch.expires_at = v;
    else return { ok: false, error: 'expires_at must be YYYY-MM-DD' };
  }
  if (input.superseded_by !== undefined) {
    const v = input.superseded_by;
    if (typeof v !== 'string' || !v.trim()) {
      return { ok: false, error: 'superseded_by must name the replacing document' };
    }
    patch.superseded_by = v.trim();
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'Nothing to update' };
  }
  return { ok: true, value: patch };
}
