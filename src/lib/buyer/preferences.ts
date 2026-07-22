// ============================================================
// Buyer portal — preference form parsing.
//
// The portal edits the SAME contacts columns as the agent contact
// form and the WhatsApp preference flow (min_budget / max_budget /
// areas_of_interest / property_interests / min_roi), so all three
// channels stay in agreement. Preferences describe the buyer, not an
// agency relationship — the PUT route writes the parsed update to
// every active linked contact.
//
// Pure module (no I/O) so it can be unit tested.
// ============================================================

import { PROPERTY_INTEREST_FLOW_OPTIONS } from '@/lib/whatsapp/preference-flow';

export const BUYER_PROPERTY_INTEREST_OPTIONS =
  PROPERTY_INTEREST_FLOW_OPTIONS.map((o) => o.id);

export interface BuyerPreferenceUpdate {
  min_budget?: number | null;
  max_budget?: number | null;
  areas_of_interest?: string[];
  property_interests?: string[];
  min_roi?: number | null;
}

function parseNumeric(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const num =
    typeof value === 'number'
      ? value
      : Number(String(value).replace(/[,\s₹%]/g, ''));
  if (!Number.isFinite(num) || num < 0) return undefined;
  return num;
}

function parseStringArray(
  value: unknown,
  allowed?: Set<string>
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && v.length <= 120)
    .filter((v) => !allowed || allowed.has(v));
  return cleaned.slice(0, 25);
}

/**
 * Map an untrusted request body onto a contacts-table update payload.
 * A present-but-null/empty numeric field means "clear this
 * preference"; a missing key means "leave as is". Unknown property
 * interests and junk values are dropped.
 */
export function parseBuyerPreferenceBody(
  raw: Record<string, unknown> | null | undefined
): BuyerPreferenceUpdate {
  const update: BuyerPreferenceUpdate = {};
  if (!raw || typeof raw !== 'object') return update;

  const minBudget = parseNumeric(raw.min_budget);
  if (minBudget !== undefined) update.min_budget = minBudget;
  const maxBudget = parseNumeric(raw.max_budget);
  if (maxBudget !== undefined) update.max_budget = maxBudget;
  const minRoi = parseNumeric(raw.min_roi);
  if (minRoi !== undefined) update.min_roi = minRoi;

  const areas = parseStringArray(raw.areas_of_interest);
  if (areas !== undefined) update.areas_of_interest = areas;

  const interests = parseStringArray(
    raw.property_interests,
    new Set(BUYER_PROPERTY_INTEREST_OPTIONS)
  );
  if (interests !== undefined) update.property_interests = interests;

  return update;
}
