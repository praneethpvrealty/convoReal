// ============================================================
// Owners Den — credit pricing for marketplace actions.
//
// Base costs live with the other billables in
// src/lib/credits/types.ts (DEN_FEATURE_COSTS); this module adds the
// tiering: stronger matches cost more to unlock, because the lead is
// worth more.
// ============================================================

import { DEN_FEATURE_COSTS } from "@/lib/credits/types";

export { DEN_FEATURE_COSTS };

/** Score-tiered unlock price: ≥80% match → premium, else base. */
export function matchUnlockCost(score: number | null | undefined): number {
  const base = DEN_FEATURE_COSTS.match_unlock;
  if (typeof score === "number" && score >= 80) return Math.round(base * 1.5);
  return base;
}

/** How long a bid stays live without an owner response. */
export const DEN_BID_EXPIRY_DAYS = 7;

/** Grace period after Deal Mode goes off before live bids auto-expire. */
export const DEAL_MODE_OFF_GRACE_HOURS = 48;
