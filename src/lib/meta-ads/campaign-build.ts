// ============================================================
// Campaign construction — pure builders for the create-campaign route.
//
// Transport-free so the money-sensitive bits (budget conversion,
// targeting geometry, validation bounds) are unit-tested without any
// Meta call.
// ============================================================

export const BUDGET_BOUNDS = {
  minInr: 200, // Meta enforces a per-currency minimum; ₹200/day is a safe floor for India
  maxInr: 100000,
} as const;

export const RADIUS_BOUNDS = {
  minKm: 2,
  maxKm: 50,
} as const;

/** Rupees → paise (Meta expects minor currency units as an integer). */
export function inrToPaise(inr: number): number {
  return Math.round(inr * 100);
}

export interface BudgetValidation {
  ok: boolean;
  reason?: string;
}

export function validateDailyBudgetInr(inr: unknown): BudgetValidation {
  if (typeof inr !== 'number' || !Number.isFinite(inr)) return { ok: false, reason: 'Enter a daily budget.' };
  if (inr < BUDGET_BOUNDS.minInr) return { ok: false, reason: `Minimum daily budget is ₹${BUDGET_BOUNDS.minInr}.` };
  if (inr > BUDGET_BOUNDS.maxInr) return { ok: false, reason: `Maximum daily budget is ₹${BUDGET_BOUNDS.maxInr.toLocaleString('en-IN')}.` };
  return { ok: true };
}

export function clampRadiusKm(km: unknown): number {
  const n = typeof km === 'number' && Number.isFinite(km) ? km : RADIUS_BOUNDS.minKm;
  return Math.min(RADIUS_BOUNDS.maxKm, Math.max(RADIUS_BOUNDS.minKm, Math.round(n)));
}

interface GeoProperty {
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
  location?: string | null;
}

export interface TargetingResult {
  /** The `targeting` object to send to Meta, when we can pin a radius
   *  around the property's exact coordinates. Null when the property
   *  has no coordinates — the caller must then resolve a city geo key
   *  (a Meta API call) or reject the request. */
  targeting: Record<string, unknown> | null;
  /** True when `targeting` is a ready-to-send radius target. */
  precise: boolean;
  /** City to resolve when not precise (from city, else locality). */
  cityFallback: string | null;
}

/**
 * Builds Meta ad-set targeting for a property. Prefers a radius around
 * the property's exact coordinates (migration 093). When coordinates
 * are absent, returns `precise: false` with a `cityFallback` for the
 * caller to resolve — never a fabricated/empty targeting object.
 */
export function buildTargeting(property: GeoProperty, radiusKm: number): TargetingResult {
  const radius = clampRadiusKm(radiusKm);

  if (
    typeof property.latitude === 'number' &&
    typeof property.longitude === 'number' &&
    Number.isFinite(property.latitude) &&
    Number.isFinite(property.longitude)
  ) {
    return {
      targeting: {
        geo_locations: {
          custom_locations: [
            {
              latitude: property.latitude,
              longitude: property.longitude,
              radius,
              distance_unit: 'kilometer',
            },
          ],
        },
        age_min: 22,
      },
      precise: true,
      cityFallback: null,
    };
  }

  const city = (property.city || property.location || '').trim();
  return { targeting: null, precise: false, cityFallback: city || null };
}
