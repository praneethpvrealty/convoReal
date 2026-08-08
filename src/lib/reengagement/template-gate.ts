// Whether a template is actually safe to send a re-engagement batch on.
//
// APPROVED alone is not the question. Meta approves a failed Utility
// submission AS Marketing rather than rejecting it, and Marketing
// templates are silently dropped (error 131049) for any recipient at
// their per-user marketing cap. A batch sent on one looks successful
// and reaches only part of the list — the single outcome this flow
// exists to prevent — so the category is part of the gate.

export interface TemplateStatusRow {
  status?: string | null;
  category?: string | null;
}

export function isTemplateApproved(
  row: TemplateStatusRow | undefined | null
): boolean {
  return (row?.status ?? '').toUpperCase() === 'APPROVED';
}

export function isTemplateUtility(
  row: TemplateStatusRow | undefined | null
): boolean {
  return (row?.category ?? '').toLowerCase() === 'utility';
}

/** Approved AND Utility — the only combination that reaches every lead. */
export function canSendToEveryLead(
  row: TemplateStatusRow | undefined | null
): boolean {
  return isTemplateApproved(row) && isTemplateUtility(row);
}

/**
 * Approved, but re-filed as Marketing by Meta's classifier. Worth
 * saying out loud rather than letting a batch quietly under-deliver.
 */
export function isApprovedButMarketing(
  row: TemplateStatusRow | undefined | null
): boolean {
  return isTemplateApproved(row) && !isTemplateUtility(row);
}
