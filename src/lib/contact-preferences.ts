// ============================================================
// Effective (display-ready) contact preferences.
//
// Two sets of preference fields live on a contact row:
//   - Explicit fields the user typed into the contact form:
//     min_budget / max_budget / no_budget / areas_of_interest /
//     property_interests. Source of truth; always win.
//   - pref_* fields Gemini extracted from the requirements/notes
//     free text (migration 092, /api/contacts/extract-preferences).
//     Fill the gaps when nothing explicit was entered.
//
// The matching engine already merges the two this way
// (src/lib/matching.ts). These helpers give the UI the SAME merge
// so the Requirements cards and the Contacts table show one
// consistent picture — a demands statement saying "Budget within
// 3 cr" surfaces as ₹3 Cr everywhere instead of "Not specified",
// with `source: 'ai'` so surfaces can mark provenance (✨).
// ============================================================

export interface ContactPreferenceFields {
  min_budget?: number | string | null;
  max_budget?: number | string | null;
  no_budget?: boolean | null;
  areas_of_interest?: string[] | null;
  property_interests?: string[] | null;
  pref_budget_min?: number | string | null;
  pref_budget_max?: number | string | null;
  pref_areas?: string[] | null;
  pref_property_categories?: string[] | null;
  pref_property_types?: string[] | null;
}

export interface EffectiveValue<T> {
  value: T;
  /** 'explicit' = user-entered field; 'ai' = extracted from free text. */
  source: 'explicit' | 'ai';
}

function positiveNumber(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonEmpty(v: string[] | null | undefined): string[] | null {
  if (!Array.isArray(v)) return null;
  const cleaned = v.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
  return cleaned.length > 0 ? cleaned : null;
}

/** Max budget with explicit-first merge. Null when neither side has one. */
export function effectiveMaxBudget(
  c: ContactPreferenceFields,
): EffectiveValue<number> | null {
  const explicit = positiveNumber(c.max_budget);
  if (explicit !== null) return { value: explicit, source: 'explicit' };
  const ai = positiveNumber(c.pref_budget_max);
  return ai !== null ? { value: ai, source: 'ai' } : null;
}

/** Areas of interest with explicit-first merge. */
export function effectiveAreas(
  c: ContactPreferenceFields,
): EffectiveValue<string[]> | null {
  const explicit = nonEmpty(c.areas_of_interest);
  if (explicit) return { value: explicit, source: 'explicit' };
  const ai = nonEmpty(c.pref_areas);
  return ai ? { value: ai, source: 'ai' } : null;
}

/**
 * Property category/type interests with explicit-first merge. The AI
 * side unions broad categories ('residential') with specific types
 * ('Flat/ Apartment'), deduped case-insensitively, categories
 * capitalized for display.
 */
export function effectiveCategories(
  c: ContactPreferenceFields,
): EffectiveValue<string[]> | null {
  const explicit = nonEmpty(c.property_interests);
  if (explicit) return { value: explicit, source: 'explicit' };
  const cats = (nonEmpty(c.pref_property_categories) ?? []).map(
    (s) => s.charAt(0).toUpperCase() + s.slice(1),
  );
  const types = nonEmpty(c.pref_property_types) ?? [];
  const seen = new Set<string>();
  const merged = [...cats, ...types].filter((s) => {
    const key = s.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return merged.length > 0 ? { value: merged, source: 'ai' } : null;
}
