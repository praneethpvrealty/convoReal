/**
 * A dismissal records a decision about a *pair* — "these two are
 * different people" — because a group is derived and its membership
 * moves. Keying on the whole set would resurface a settled pair every
 * time a third record joined it, or worse, hide that third record
 * behind a decision taken before it existed.
 *
 * So a group stays hidden exactly while every pair inside it has been
 * dismissed, and one genuinely new member brings the whole group back
 * for a fresh look.
 */

export type ContactPair = [string, string];

/** Canonical order, so one decision cannot be stored under two spellings. */
export function orderPair(a: string, b: string): ContactPair {
  return a < b ? [a, b] : [b, a];
}

export function pairKey(a: string, b: string): string {
  return orderPair(a, b).join(':');
}

/** Every unordered pair within a group. */
export function pairsWithin(ids: string[]): ContactPair[] {
  const pairs: ContactPair[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs.push(orderPair(ids[i], ids[j]));
    }
  }
  return pairs;
}

/** Whether every pairing in this group has already been ruled out. */
export function isGroupDismissed(ids: string[], dismissed: Set<string>): boolean {
  const pairs = pairsWithin(ids);
  if (pairs.length === 0) return false;
  return pairs.every(([a, b]) => dismissed.has(pairKey(a, b)));
}
