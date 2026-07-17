// ============================================================
// /api/den/properties/[id] — one of the owner's listings.
//
// GET   — whitelisted detail view.
// PATCH — owner-editable fields only (see DEN_EDITABLE_FIELDS);
//         structural changes stay with the managing agency.
//
// Ownership check: the property's owner_contact_id must be one of the
// caller's active den_contact_links — a Den user can never read or
// write another owner's row, even within the same agency.
// ============================================================

import { NextResponse } from "next/server";

import { UserFacingError } from "@/lib/auth/account";
import { withDenAuth, denAdmin } from "@/lib/den/auth";
import { DEN_PROPERTY_SELECT, pickDenEditableFields, loadOwnedProperty } from "@/lib/den/properties";

export const GET = withDenAuth(async (ctx, _req, routeCtx) => {
  const { id } = await routeCtx.params;
  const property = await loadOwnedProperty(ctx, id);
  if (!property) throw new UserFacingError("Property not found", 404);
  const agency = ctx.links.find((l) => l.accountId === (property.account_id as string));
  return NextResponse.json({ property: { ...property, agency_name: agency?.agencyName ?? null } });
});

const NUMERIC_EDITABLE = new Set(["price", "rent_per_month", "maintenance", "advance", "gst", "min_bid"]);
const STRING_EDITABLE = new Set(["title", "description"]);
const ARRAY_EDITABLE = new Set(["features", "nearby_highlights"]);

export const PATCH = withDenAuth(async (ctx, req, routeCtx) => {
  const { id } = await routeCtx.params;
  const existing = await loadOwnedProperty(ctx, id);
  if (!existing) throw new UserFacingError("Property not found", 404);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw new UserFacingError("Invalid request body");

  const picked = pickDenEditableFields(body);
  const update: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(picked)) {
    if (NUMERIC_EDITABLE.has(field)) {
      if (value === null) update[field] = null;
      else if (typeof value === "number" && Number.isFinite(value) && value >= 0) update[field] = value;
      else throw new UserFacingError(`Invalid value for ${field}`);
    } else if (STRING_EDITABLE.has(field)) {
      if (typeof value !== "string" || !value.trim()) throw new UserFacingError(`Invalid value for ${field}`);
      update[field] = value.slice(0, field === "description" ? 5000 : 200);
    } else if (ARRAY_EDITABLE.has(field)) {
      if (!Array.isArray(value)) throw new UserFacingError(`Invalid value for ${field}`);
      update[field] = value.filter((v) => typeof v === "string").slice(0, 40);
    }
  }
  if (Object.keys(update).length === 0) {
    throw new UserFacingError("No editable fields in request");
  }
  update.updated_at = new Date().toISOString();

  const db = denAdmin();
  const { data, error } = await db
    .from("properties")
    .update(update)
    .eq("id", id)
    .select(DEN_PROPERTY_SELECT)
    .single();
  if (error || !data) {
    console.error("[den/properties/:id PATCH] update failed:", error);
    return NextResponse.json({ error: "Could not save changes" }, { status: 500 });
  }
  return NextResponse.json({ property: data });
});
