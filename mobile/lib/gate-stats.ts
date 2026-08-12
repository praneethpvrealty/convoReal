// Port of the web's src/lib/inventory/gate-stats.ts summary helpers, so
// a confidential listing's card reads identically on both surfaces.
//
// Ported rather than imported: @shared/ is a types-only alias here, and
// the pure helpers are small. src/lib/mobile-parity.test.ts pins the
// wording — an agent seeing "3 asked · 1 open" on the phone and
// something else on the desktop would not know which to trust.

export interface GateStats {
  requested: number;
  pending: number;
  approved: number;
  rejected: number;
  liveGrants: number;
  lastRequestedAt: string | null;
}

export type GateStatsMap = Record<string, GateStats>;

/** True when a listing has nothing worth putting on its card yet: it is
 *  gated but untouched. */
export function hasGateActivity(s: GateStats | undefined): boolean {
  if (!s) return false;
  return s.requested > 0 || s.liveGrants > 0;
}

/** The card's one-line summary. */
export function gateSummary(s: GateStats | undefined): string | null {
  if (!hasGateActivity(s) || !s) return null;
  const parts: string[] = [];
  if (s.requested > 0) parts.push(`${s.requested} asked`);
  if (s.pending > 0) parts.push(`${s.pending} waiting`);
  if (s.liveGrants > 0) parts.push(`${s.liveGrants} open`);
  return parts.join(' · ');
}
