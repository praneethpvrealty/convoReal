/**
 * Which listings the proactive senders are still allowed to talk about.
 *
 * A listing that leaves the market keeps every row that references it —
 * enquiries, deals, shares, showcase views — so a digest that scans
 * `properties` will happily keep reporting buyer activity on a flat that
 * sold weeks ago, and ask its former owner whether they would like
 * updates about it. The scanning senders (owner digest, agent reach
 * digest, deal-mode sweep) filter on the list below. Reactive paths that
 * answer something a user just did are deliberately unaffected — a sold
 * property still has an owner who can request its documents.
 */

export const CLOSED_LISTING_STATUSES = [
  'Sold',
  'Off Market',
  'Archived',
  'Rejected',
];

/** PostgREST `not.in` operand — the multi-word statuses need quoting. */
export const CLOSED_LISTING_STATUS_FILTER = `("${CLOSED_LISTING_STATUSES.join('","')}")`;

export function isListingClosed(status: string | null | undefined): boolean {
  return !!status && CLOSED_LISTING_STATUSES.includes(status);
}
