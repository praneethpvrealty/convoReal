// ============================================================
// Confidential-gate rollup per listing (migration 258).
//
// The approvals panel answers "what needs a decision now". It cannot
// answer "how is this listing doing", because it is a work queue: it is
// account-wide and it empties as you use it. So a listing that had ten
// requests looked exactly like one nobody had asked about.
//
// Counted in SQL, once for the account, rather than per card — the
// inventory grid renders dozens of cards and a COUNT(*) each is a real
// scan each (AGENTS.md §2.6).
// ============================================================

export interface GateStats {
  requested: number;
  pending: number;
  approved: number;
  /** Rejections and timed-out consent chains together: to the agent
   *  reading a card, a request that never got an answer and one that
   *  was refused have the same meaning. */
  rejected: number;
  /** Keys that open the listing right now — neither expired nor
   *  revoked. The number an agent acts on. */
  liveGrants: number;
  lastRequestedAt: string | null;
}

export type GateStatsMap = Record<string, GateStats>;

interface GateStatsRow {
  property_id: string;
  requested: number | null;
  pending: number | null;
  approved: number | null;
  rejected: number | null;
  live_grants: number | null;
  last_requested_at: string | null;
}

const num = (v: number | null | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

/** Shapes the RPC rows into the propertyId → stats map both surfaces
 *  render from. Pure, so the mapping is testable without a database. */
export function toGateStatsMap(rows: GateStatsRow[] | null): GateStatsMap {
  const map: GateStatsMap = {};
  for (const row of rows ?? []) {
    if (!row?.property_id) continue;
    map[row.property_id] = {
      requested: num(row.requested),
      pending: num(row.pending),
      approved: num(row.approved),
      rejected: num(row.rejected),
      liveGrants: num(row.live_grants),
      lastRequestedAt: row.last_requested_at ?? null,
    };
  }
  return map;
}

/** True when a listing has nothing worth putting on its card yet: it is
 *  gated but untouched. The badge still renders (it says "Confidential"),
 *  the counts do not. */
export function hasGateActivity(s: GateStats | undefined): boolean {
  if (!s) return false;
  return s.requested > 0 || s.liveGrants > 0;
}

/** How a request's status reads to the agent. A consent chain that timed
 *  out never reached a decision, so it says so rather than claiming the
 *  listing side refused. Shared with mobile for the same reason the
 *  summary is. */
export function gateRequestStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Waiting on you';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    default:
      return 'No answer';
  }
}

/** The card's one-line summary. Kept here rather than in the component
 *  so web and mobile cannot word it differently. */
export function gateSummary(s: GateStats | undefined): string | null {
  if (!hasGateActivity(s) || !s) return null;
  const parts: string[] = [];
  if (s.requested > 0) parts.push(`${s.requested} asked`);
  if (s.pending > 0) parts.push(`${s.pending} waiting`);
  if (s.liveGrants > 0) parts.push(`${s.liveGrants} open`);
  return parts.join(' · ');
}
