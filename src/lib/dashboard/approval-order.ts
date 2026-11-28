export interface ApprovalOrderRow {
  status: string;
  pending_consent_contact_name?: string | null;
  stalled_contact_name?: string | null;
}

export type LocationApprovalTone =
  'decide' | 'stalled' | 'wait' | 'ok' | 'muted';

function rank(row: ApprovalOrderRow): number {
  if (row.pending_consent_contact_name) return 1;
  return 0;
}

export function splitLocationApprovals<T extends ApprovalOrderRow>(
  rows: T[]
): { open: T[]; closed: T[]; approved: T[] } {
  const open = rows
    .filter((row) => row.status === 'pending')
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index)
    .map(({ row }) => row);
  const closed = rows.filter(
    (row) => row.status !== 'pending' && row.status !== 'approved'
  );
  const approved = rows.filter((row) => row.status === 'approved');
  return { open, closed, approved };
}

export function locationApprovalStatus(row: ApprovalOrderRow): {
  text: string;
  tone: LocationApprovalTone;
} {
  if (row.status === 'pending' && row.pending_consent_contact_name) {
    return {
      text: `Awaiting ${row.pending_consent_contact_name}`,
      tone: 'wait',
    };
  }
  if (row.status === 'pending' && row.stalled_contact_name) {
    return {
      text: `${row.stalled_contact_name} didn't reply — your call`,
      tone: 'stalled',
    };
  }
  if (row.status === 'pending')
    return { text: 'Your decision', tone: 'decide' };
  if (row.status === 'approved') return { text: 'Approved', tone: 'ok' };
  if (row.status === 'rejected') return { text: 'Rejected', tone: 'muted' };
  return { text: 'Timed out', tone: 'muted' };
}

export function canDecideLocationRequest(row: ApprovalOrderRow): boolean {
  return row.status === 'pending' && !row.pending_consent_contact_name;
}
