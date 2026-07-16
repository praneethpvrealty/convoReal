// ============================================================
// Owners Den — property field whitelists.
//
// Den routes never `select('*')` on properties: owners see their own
// listings, but not CRM internals written by agents. The SELECT list
// below is the single source of truth for what an owner can READ;
// DEN_EDITABLE_FIELDS is what they can WRITE (everything else —
// status, publishing, type changes — stays with the managing agency,
// who review owner listings through the normal Pending Review flow).
//
// Deliberately excluded from SELECT:
//   * notes            — internal agent notes
//   * deal_remarks     — internal land/JV notes
//   * is_starred       — CRM UI state
//   * user_id          — the staff member who created the row
//   * meta_catalog_*   — Meta catalog sync internals
// ============================================================

import { denAdmin, type DenContext } from "./auth";

export type DealMode = "off" | "soft" | "aggressive";

export const DEAL_MODES: DealMode[] = ["off", "soft", "aggressive"];

export const DEN_PROPERTY_SELECT = [
  "id",
  "account_id",
  "title",
  "description",
  "price",
  "sold_price",
  "location",
  "type",
  "status",
  "listing_type",
  "rent_per_month",
  "maintenance",
  "advance",
  "gst",
  "jv_structure",
  "owner_share_percent",
  "builder_share_percent",
  "goodwill_amount",
  "bts_lease_years",
  "bts_lock_in_years",
  "bts_escalation_percent",
  "ownership_status",
  "land_use_zoning",
  "bedrooms",
  "bathrooms",
  "area_sqft",
  "area_unit",
  "land_area",
  "land_area_unit",
  "super_built_area",
  "sublocality",
  "city",
  "state",
  "project",
  "latitude",
  "longitude",
  "land_zone",
  "ideal_for",
  "dimensions",
  "road_width",
  "road_width_unit",
  "facing_direction",
  "nearby_highlights",
  "is_published",
  "features",
  "images",
  "documents",
  "google_map_link",
  "property_code",
  "owner_contact_id",
  "rental_income",
  "roi",
  "floor_tenancies",
  "listing_source",
  "deal_mode",
  "deal_mode_updated_at",
  "deal_mode_set_by",
  "created_at",
  "updated_at",
].join(", ");

/** Fields an owner may edit directly on their listing. Structural
 *  changes (type, status, publish state, location) go through the
 *  managing agency instead. */
export const DEN_EDITABLE_FIELDS = [
  "title",
  "description",
  "price",
  "rent_per_month",
  "maintenance",
  "advance",
  "gst",
  "features",
  "nearby_highlights",
] as const;

export type DenEditableField = (typeof DEN_EDITABLE_FIELDS)[number];

/**
 * Loads one property IF it belongs to the calling Den user (its
 * owner_contact_id is one of their active links). Returns null on
 * miss — routes turn that into a 404, indistinguishable from a
 * property that doesn't exist at all.
 */
export async function loadOwnedProperty(
  ctx: DenContext,
  propertyId: string,
): Promise<Record<string, unknown> | null> {
  const contactIds = ctx.links.map((l) => l.contactId);
  if (contactIds.length === 0) return null;
  const db = denAdmin();
  const { data, error } = await db
    .from("properties")
    .select(DEN_PROPERTY_SELECT)
    .eq("id", propertyId)
    .in("owner_contact_id", contactIds)
    .maybeSingle();
  if (error) {
    console.error("[loadOwnedProperty] fetch error:", error);
    return null;
  }
  return data as Record<string, unknown> | null;
}

/** Picks only owner-editable fields from an untrusted payload. */
export function pickDenEditableFields(
  payload: Record<string, unknown>,
): Partial<Record<DenEditableField, unknown>> {
  const out: Partial<Record<DenEditableField, unknown>> = {};
  for (const field of DEN_EDITABLE_FIELDS) {
    if (payload[field] !== undefined) out[field] = payload[field];
  }
  return out;
}
