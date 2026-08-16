// ============================================================
// Per-floor plan drawings (migration 285). One JSONB array on the
// property; each element pins a plan image to a floor.
//
// Distinct from floor_tenancies, which is the commercial rent roll:
// a plan applies to any property type, so a residential house's
// ground/first floor layouts live here. A rent-roll floor can also
// carry its own plan via FloorTenancy.floor_plan — same storage path
// shape, kept beside its tenant.
//
// Pure helpers, mirroring floor-tenancies.ts: API routes sanitize
// untrusted payloads with sanitizeFloorPlans().
// ============================================================

export interface FloorPlan {
  /** Floor / unit label, e.g. "Ground Floor", "Typical Floor". */
  floor: string;
  /** Stored image path ("property-images/<account>/img-...jpg"), or an
   *  absolute URL. Resolved at the read boundary by storagePublicUrl().
   *  Null while a floor is listed but its drawing has not arrived. */
  image: string | null;
  area_sqft: number | null;
  /** Free text — "3 BHK + pooja room", "column-free retail". */
  notes: string | null;
  /** Source page in the brochure the plan was read from. Used to match
   *  an extracted drawing to its floor at intake, and kept afterwards
   *  so a re-import can tell which floors came from the document. */
  page?: number | null;
}

const MAX_FLOORS = 60;
const MAX_TEXT = 300;
const MAX_PATH = 500;

function str(v: unknown, max = MAX_TEXT): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Normalizes a stored media reference. Bounded, and never a `data:`
 *  or `javascript:` payload — these paths are interpolated into image
 *  URLs on the showcase and in flyers. */
export function sanitizeFloorPlanImage(v: unknown): string | null {
  const path = str(v, MAX_PATH);
  if (!path) return null;
  if (/^(https?:)?\/\//i.test(path)) return path;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  return path;
}

/**
 * Normalizes an untrusted floor_plans payload into a bounded,
 * well-typed array. Rows carrying neither a label nor a drawing are
 * dropped; anything that isn't an array becomes [].
 */
export function sanitizeFloorPlans(raw: unknown): FloorPlan[] {
  if (!Array.isArray(raw)) return [];
  const rows: FloorPlan[] = [];
  for (const item of raw.slice(0, MAX_FLOORS)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const row: FloorPlan = {
      floor: str(r.floor, 80) || '',
      image: sanitizeFloorPlanImage(r.image),
      area_sqft: num(r.area_sqft),
      notes: str(r.notes),
      page: num(r.page),
    };
    if (row.floor || row.image) rows.push(row);
  }
  return rows;
}

/** Floors that actually carry a drawing — what a gallery renders. */
export function plansWithImages(
  plans: FloorPlan[] | null | undefined
): FloorPlan[] {
  if (!Array.isArray(plans)) return [];
  return plans.filter((p) => Boolean(p.image));
}

/** A drawing pulled out of the source document, reduced to what
 *  matching needs. Kept structural so this file stays free of PDF
 *  concerns and testable without one. */
export interface PlanCandidate {
  url: string;
  page: number;
}

/**
 * Pins extracted drawings to the floors the parser named.
 *
 * The page number is the strong signal — a plan is printed on the page
 * that captions it — so pages are matched first, and only then are
 * leftover drawings handed to still-empty floors in document order. A
 * floor that ends with no drawing keeps `image: null` rather than
 * borrowing one: a wrong plan on a floor is worse than a missing one,
 * and the form lets someone attach it in a click.
 */
export function attachPlanImages(
  plans: FloorPlan[],
  candidates: PlanCandidate[]
): FloorPlan[] {
  const taken = new Set<number>();
  const byPage = plans.map((plan) => {
    if (plan.image || !plan.page) return plan;
    const idx = candidates.findIndex(
      (c, i) => !taken.has(i) && c.page === plan.page
    );
    if (idx === -1) return plan;
    taken.add(idx);
    return { ...plan, image: candidates[idx].url };
  });

  const spare = candidates.filter((_, i) => !taken.has(i));
  let next = 0;
  return byPage.map((plan) => {
    if (plan.image || next >= spare.length) return plan;
    return { ...plan, image: spare[next++].url };
  });
}

/**
 * Intake wiring: pins a brochure's drawings onto the floors the parser
 * named, and reports whichever drawings found no floor.
 *
 * When the document named no floors at all, every drawing is reported
 * unused — an unlabelled floor row helps nobody, and the caller sends
 * those images to the ordinary gallery instead, where they are at
 * least visible and can be pinned by hand later.
 */
export function pinBrochurePlans(
  named: FloorPlan[] | null | undefined,
  candidates: PlanCandidate[]
): { plans: FloorPlan[]; unused: string[] } {
  const floors = sanitizeFloorPlans(named);
  if (floors.length === 0) {
    return { plans: [], unused: candidates.map((c) => c.url) };
  }
  const plans = attachPlanImages(floors, candidates);
  const used = new Set(plans.map((p) => p.image).filter(Boolean));
  return {
    plans,
    unused: candidates.filter((c) => !used.has(c.url)).map((c) => c.url),
  };
}
