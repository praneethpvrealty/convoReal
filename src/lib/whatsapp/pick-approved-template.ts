// ============================================================
// Which of several candidate names a send should actually use.
//
// An engine template gets renamed whenever Meta miscategorises it,
// because Meta fixes a category at first review and refuses to move it
// afterwards — so every fix ships under a name Meta has not ruled on
// while the previous name keeps sending. That leaves an account
// holding two or three rows for one job, in assorted states.
//
// Category outranks name. A Marketing template is silently dropped for
// any recipient at their per-user cap (error 131049), which is the
// whole reason these names get bumped — so an approved UTILITY row
// under an old name beats an approved MARKETING row under the newest
// one. Preferring the new name blindly is how a rename, if Meta
// miscategorises it, quietly stops half the sends it was meant to
// improve.
//
// Within the same category, the newest name wins.
// ============================================================

export interface ApprovedTemplateCandidate {
  name: string;
  /** Optional because MessageTemplate leaves it so — a required field
   *  here silently stops MessageTemplate satisfying the constraint, and
   *  the generic collapses to this interface. */
  status?: string | null;
  category?: string | null;
}

export function pickApprovedTemplate<T extends ApprovedTemplateCandidate>(
  rows: T[],
  orderedNames: readonly string[],
): T | null {
  const approved = rows.filter(
    (t) => t.status === 'APPROVED' && orderedNames.includes(t.name),
  );
  if (!approved.length) return null;

  const nameRank = (name: string): number => {
    const i = orderedNames.indexOf(name);
    return i === -1 ? orderedNames.length : i;
  };

  return [...approved].sort((a, b) => {
    const category =
      (a.category === 'Utility' ? 0 : 1) - (b.category === 'Utility' ? 0 : 1);
    if (category !== 0) return category;
    return nameRank(a.name) - nameRank(b.name);
  })[0];
}
