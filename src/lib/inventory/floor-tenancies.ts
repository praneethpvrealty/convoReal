// ============================================================
// Floor-wise tenancy (rent roll) for pre-leased commercial
// buildings under sale — tenant, rent (excluding GST), lease
// window, lock-in and maintenance per floor/unit. Stored as a
// JSONB array on properties.floor_tenancies (migration 130).
//
// Pure helpers: the API routes sanitize untrusted payloads with
// sanitizeFloorTenancies(), the form and cards sum with
// totalMonthlyRent(). CRM-internal data — never shown on the
// public showcase.
// ============================================================

export interface FloorTenancy {
  /** Floor / unit label, e.g. "Ground Floor", "2nd + 3rd Floor". */
  floor: string;
  area_sqft: number | null;
  tenant_name: string | null;
  /** Monthly rent for this floor, excluding GST. */
  monthly_rent: number | null;
  /** ISO date (YYYY-MM-DD). */
  lease_start: string | null;
  lease_end: string | null;
  lock_in_months: number | null;
  /** Free text — "₹5/sqft borne by tenant", a monthly amount, etc. */
  maintenance: string | null;
  /** Usage / anything else: "3-Star Hotel · 27 rooms". */
  notes: string | null;
}

const MAX_FLOORS = 60;
const MAX_TEXT = 300;

function str(v: unknown, max = MAX_TEXT): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

function isoDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

/**
 * Normalizes an untrusted floor_tenancies payload into a bounded,
 * well-typed array. Rows with no data at all are dropped; anything
 * that isn't an array becomes [].
 */
export function sanitizeFloorTenancies(raw: unknown): FloorTenancy[] {
  if (!Array.isArray(raw)) return [];
  const rows: FloorTenancy[] = [];
  for (const item of raw.slice(0, MAX_FLOORS)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const row: FloorTenancy = {
      floor: str(r.floor, 80) || '',
      area_sqft: num(r.area_sqft),
      tenant_name: str(r.tenant_name, 120),
      monthly_rent: num(r.monthly_rent),
      lease_start: isoDate(r.lease_start),
      lease_end: isoDate(r.lease_end),
      lock_in_months: num(r.lock_in_months),
      maintenance: str(r.maintenance),
      notes: str(r.notes),
    };
    const hasData =
      row.floor ||
      row.tenant_name ||
      row.monthly_rent !== null ||
      row.area_sqft !== null ||
      row.lease_start ||
      row.lease_end ||
      row.lock_in_months !== null ||
      row.maintenance ||
      row.notes;
    if (hasData) rows.push(row);
  }
  return rows;
}

/** Sum of all floors' monthly rent (excluding GST); null when no
 *  floor carries a rent figure. */
export function totalMonthlyRent(tenancies: FloorTenancy[] | null | undefined): number | null {
  if (!tenancies || tenancies.length === 0) return null;
  let total = 0;
  let any = false;
  for (const t of tenancies) {
    if (t.monthly_rent !== null && t.monthly_rent !== undefined) {
      total += t.monthly_rent;
      any = true;
    }
  }
  return any ? total : null;
}
