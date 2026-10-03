export interface ApprovalOrderRow {
  status: string;
  pending_consent_contact_name?: string | null;
}

function rank(row: ApprovalOrderRow): number {
  if (row.status !== 'pending') return 2;
  return row.pending_consent_contact_name ? 1 : 0;
}

export function splitLocationApprovals<T extends ApprovalOrderRow>(
  rows: T[]
): { open: T[]; approved: T[] } {
  const open = rows
    .filter((row) => row.status !== 'approved')
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index)
    .map(({ row }) => row);
  const approved = rows.filter((row) => row.status === 'approved');
  return { open, approved };
}
