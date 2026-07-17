// ============================================================
// Owners Den — masked property snapshots.
//
// THE single place that decides what a buyer/agent in ANOTHER tenant
// may see about a Deal Mode property BEFORE paying to unlock it.
// Both the cron sweep and any API path must build snapshots through
// buildMaskedPropertySnapshot — never spread a raw property row into
// an event payload.
//
// Deliberately excluded: title, exact location/address, images,
// google_map_link, coordinates, owner identity, property_code,
// anything CRM-internal.
// ============================================================

import type { Property } from "@/types";

export interface MaskedPropertySnapshot {
  property_id: string;
  /** The OWNING tenant — needed by the unlock route, never rendered. */
  owner_account_id: string;
  type: string;
  listing_type: string;
  /** Locality-level only (sublocality or city). */
  locality: string | null;
  city: string | null;
  price_band: string | null;
  rent_band: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqft: number | null;
  area_unit: string | null;
  deal_mode: "soft" | "aggressive";
}

/** Rounds a value DOWN/UP to a clean step so the band doesn't reverse-
 *  engineer the exact ask. */
function bandEdges(value: number): [number, number] {
  const low = value * 0.93;
  const high = value * 1.07;
  const step =
    value >= 1_00_00_000 ? 10_00_000 : value >= 1_00_000 ? 1_00_000 : value >= 10_000 ? 5_000 : 500;
  return [Math.floor(low / step) * step, Math.ceil(high / step) * step];
}

function compactINR(value: number): string {
  if (value >= 1_00_00_000) {
    const cr = value / 1_00_00_000;
    return `₹${cr % 1 === 0 ? cr.toFixed(0) : cr.toFixed(1)} Cr`;
  }
  if (value >= 1_00_000) {
    const l = value / 1_00_000;
    return `₹${l % 1 === 0 ? l.toFixed(0) : l.toFixed(1)} L`;
  }
  return `₹${value.toLocaleString("en-IN")}`;
}

export function priceBand(value: number | null | undefined): string | null {
  if (!value || !Number.isFinite(Number(value)) || Number(value) <= 0) return null;
  const [low, high] = bandEdges(Number(value));
  return `${compactINR(low)} – ${compactINR(high)}`;
}

export function buildMaskedPropertySnapshot(property: Property): MaskedPropertySnapshot {
  return {
    property_id: property.id,
    owner_account_id: property.account_id,
    type: property.type,
    listing_type: property.listing_type || "Sale",
    locality: property.sublocality || property.city || null,
    city: property.city || null,
    price_band: property.listing_type === "Rent" ? null : priceBand(property.price),
    rent_band: property.listing_type === "Rent" ? priceBand(property.rent_per_month) : null,
    bedrooms: property.bedrooms ?? null,
    bathrooms: property.bathrooms ?? null,
    area_sqft: property.area_sqft ?? null,
    area_unit: property.area_unit ?? null,
    deal_mode: property.deal_mode === "aggressive" ? "aggressive" : "soft",
  };
}

/** What a buyer sees AFTER unlocking — the listing content, still not
 *  the owning tenant's CRM internals (notes, deal_remarks, rent roll,
 *  sold price). Owner name/phone are added by the unlock route from
 *  the owner contact. */
export const UNLOCKED_PROPERTY_SELECT = [
  "id",
  "account_id",
  "title",
  "description",
  "price",
  "location",
  "type",
  "status",
  "listing_type",
  "rent_per_month",
  "maintenance",
  "advance",
  "gst",
  "bedrooms",
  "bathrooms",
  "area_sqft",
  "area_unit",
  "land_area",
  "land_area_unit",
  "sublocality",
  "city",
  "state",
  "latitude",
  "longitude",
  "facing_direction",
  "nearby_highlights",
  "features",
  "images",
  "google_map_link",
  "property_code",
  "owner_contact_id",
  "deal_mode",
  "created_at",
].join(", ");
