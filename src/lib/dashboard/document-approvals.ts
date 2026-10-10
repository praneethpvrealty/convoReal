export const DOCUMENT_REQUEST_STALE_DAYS = 7;
export const DOCUMENT_DECIDED_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DocumentApprovalRow {
  id: string;
  property_id: string;
  property_title: string;
  property_code: string | null;
  document_count: number;
  requester_name: string;
  requester_phone: string;
  requester_email: string | null;
  status: string;
  share_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export type DocumentApprovalStage =
  'pending' | 'stale' | 'approved' | 'rejected';

export interface DocumentApprovalGroup<T extends DocumentApprovalRow> {
  key: string;
  requester_name: string;
  requester_phone: string;
  requester_email: string | null;
  rows: T[];
  stale: boolean;
}

export function countPropertyDocuments(documents: unknown): number {
  if (!Array.isArray(documents)) return 0;
  return documents.filter((document) => {
    if (typeof document === 'string') return document.trim().length > 0;
    if (!document || typeof document !== 'object') return false;
    return Boolean((document as { url?: string }).url?.trim());
  }).length;
}

export function documentRequestAgeDays(
  createdAt: string,
  now: Date = new Date()
): number {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((now.getTime() - created) / DAY_MS));
}

export function documentApprovalStage(
  row: Pick<DocumentApprovalRow, 'status' | 'created_at'>,
  now: Date = new Date()
): DocumentApprovalStage {
  if (row.status === 'approved') return 'approved';
  if (row.status === 'pending') {
    return documentRequestAgeDays(row.created_at, now) >=
      DOCUMENT_REQUEST_STALE_DAYS
      ? 'stale'
      : 'pending';
  }
  return 'rejected';
}

function daysLabel(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

export function documentRequestWaitLabel(
  row: Pick<DocumentApprovalRow, 'status' | 'created_at'>,
  now: Date = new Date()
): string {
  const days = documentRequestAgeDays(row.created_at, now);
  if (documentApprovalStage(row, now) === 'stale') {
    return `Timed out · ${daysLabel(days)}`;
  }
  return days === 0 ? 'Waiting since today' : `Waiting ${daysLabel(days)}`;
}

export function documentApprovalCopy(
  row: Pick<DocumentApprovalRow, 'status' | 'created_at' | 'document_count'>,
  now: Date = new Date()
): { approve: string; reject: string; hint: string | null } {
  const stale = documentApprovalStage(row, now) === 'stale';
  const noDocuments = row.document_count <= 0;
  const approve = noDocuments
    ? stale
      ? 'Approve anyway'
      : 'Approve without documents'
    : stale
      ? 'Send anyway'
      : `Approve & send ${row.document_count} ${row.document_count === 1 ? 'doc' : 'docs'}`;
  const hint = noDocuments
    ? 'No documents uploaded yet. Approving sends a note that they are being prepared.'
    : stale
      ? 'The requester may have moved on since asking.'
      : null;
  return { approve, reject: stale ? 'Dismiss' : 'Reject', hint };
}

export function documentDecisionLabel(
  row: Pick<DocumentApprovalRow, 'status' | 'share_sent_at'>
): string {
  if (row.status === 'approved') {
    return row.share_sent_at ? 'Link sent' : 'Approved · follow up';
  }
  return 'Rejected';
}

function newestFirst(a: DocumentApprovalRow, b: DocumentApprovalRow): number {
  return b.created_at.localeCompare(a.created_at);
}

export function groupDocumentApprovals<T extends DocumentApprovalRow>(
  rows: T[],
  now: Date = new Date()
): { open: DocumentApprovalGroup<T>[]; decided: T[] } {
  const groups = new Map<string, DocumentApprovalGroup<T>>();
  for (const row of [...rows].sort(newestFirst)) {
    if (row.status !== 'pending') continue;
    const key = row.requester_phone || row.requester_email || row.id;
    const group = groups.get(key) ?? {
      key,
      requester_name: row.requester_name,
      requester_phone: row.requester_phone,
      requester_email: row.requester_email,
      rows: [],
      stale: true,
    };
    group.rows.push(row);
    if (documentApprovalStage(row, now) === 'pending') group.stale = false;
    if (!group.requester_email && row.requester_email) {
      group.requester_email = row.requester_email;
    }
    groups.set(key, group);
  }
  const open = [...groups.values()].sort(
    (a, b) =>
      Number(a.stale) - Number(b.stale) || newestFirst(a.rows[0], b.rows[0])
  );
  const decided = rows
    .filter((row) => row.status !== 'pending')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return { open, decided };
}
