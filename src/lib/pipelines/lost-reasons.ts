export const LOST_REASONS = [
  'Price disagreement',
  'Terms disagreement',
  'Owner backed out',
  'Buyer backed out',
  'Legal or document issue',
  'Financing fell through',
  'Bought elsewhere',
  'Other',
] as const;

export type LostReason = (typeof LOST_REASONS)[number];

export interface LostReasonInput {
  lost_reason: LostReason;
  lost_note: string | null;
}

export const LOST_REASON_ERROR =
  "'lost_reason' must be one of the listed reasons, and 'Other' needs a note";

export function isLostReason(value: unknown): value is LostReason {
  return (
    typeof value === 'string' &&
    (LOST_REASONS as readonly string[]).includes(value)
  );
}

export function lostReasonNeedsNote(reason: LostReason | null): boolean {
  return reason === 'Other';
}

export function parseLostReason(
  raw: Record<string, unknown>
): { ok: true; value: LostReasonInput | null } | { ok: false; error: string } {
  const { lost_reason, lost_note } = raw;
  if (lost_reason === undefined || lost_reason === null) {
    return { ok: true, value: null };
  }
  if (!isLostReason(lost_reason)) {
    return { ok: false, error: LOST_REASON_ERROR };
  }
  const note =
    typeof lost_note === 'string' && lost_note.trim()
      ? lost_note.trim().slice(0, 500)
      : null;
  if (lostReasonNeedsNote(lost_reason) && !note) {
    return { ok: false, error: LOST_REASON_ERROR };
  }
  return { ok: true, value: { lost_reason, lost_note: note } };
}

export function lostReasonLabel(deal: {
  lost_reason?: string | null;
  lost_note?: string | null;
}): string | null {
  if (!deal.lost_reason) return null;
  return deal.lost_note
    ? `${deal.lost_reason}: ${deal.lost_note}`
    : deal.lost_reason;
}
