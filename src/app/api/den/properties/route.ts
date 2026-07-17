// ============================================================
// /api/den/properties — the owner's listings across all linked
// agencies.
//
// GET  — every property whose owner_contact_id is one of the caller's
//        linked contacts, whitelisted columns only.
// POST — create a new listing as the owner. Lands as Pending Review /
//        unpublished with listing_source 'owner'; the managing agency
//        completes and publishes it through their normal inventory
//        review (same trust model as the public /list funnel, but the
//        Den user's phone is already verified so no code round-trip).
// ============================================================

import { NextResponse } from "next/server";

import { UserFacingError } from "@/lib/auth/account";
import { withDenAuth, denAdmin } from "@/lib/den/auth";
import { DEN_PROPERTY_SELECT } from "@/lib/den/properties";
import { PROPERTY_TYPE_VALUES, normalizePropertyType } from "@/lib/property-types";

export const GET = withDenAuth(async (ctx) => {
  if (ctx.links.length === 0) {
    return NextResponse.json({ properties: [] });
  }
  const db = denAdmin();
  const { data, error } = await db
    .from("properties")
    .select(DEN_PROPERTY_SELECT)
    .in("owner_contact_id", ctx.links.map((l) => l.contactId))
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[den/properties GET] query error:", error);
    return NextResponse.json({ error: "Could not load your properties" }, { status: 500 });
  }

  const agencyByAccount = new Map(ctx.links.map((l) => [l.accountId, l.agencyName]));
  const rows = (data || []) as unknown as Record<string, unknown>[];
  const properties = rows.map((p) => ({
    ...p,
    agency_name: agencyByAccount.get(p.account_id as string) ?? null,
  }));
  return NextResponse.json({ properties });
});

const NUMERIC_FIELDS = [
  "price",
  "rent_per_month",
  "maintenance",
  "advance",
  "gst",
  "bedrooms",
  "bathrooms",
  "area_sqft",
  "land_area",
] as const;

export const POST = withDenAuth(async (ctx, req) => {
  if (ctx.links.length === 0) {
    throw new UserFacingError(
      "Your number isn't linked to a managing agency yet. Ask your agency to add you as an owner, or submit through their listing page.",
      409,
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw new UserFacingError("Invalid request body");

  // Which agency this listing belongs to — defaults to the only link.
  const requestedAccountId = typeof body.account_id === "string" ? body.account_id : null;
  const link = requestedAccountId
    ? ctx.links.find((l) => l.accountId === requestedAccountId)
    : ctx.links.length === 1
      ? ctx.links[0]
      : null;
  if (!link) {
    throw new UserFacingError(
      requestedAccountId
        ? "That agency isn't linked to your account."
        : "Choose which agency should manage this listing (account_id).",
    );
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const location = typeof body.location === "string" ? body.location.trim() : "";
  if (!title) throw new UserFacingError("Title is required");
  if (!location) throw new UserFacingError("Location is required");

  const listingType = ["Sale", "Rent"].includes(body.listing_type as string)
    ? (body.listing_type as string)
    : "Sale";
  const rawType = typeof body.type === "string" ? body.type : "";
  const type = (PROPERTY_TYPE_VALUES as readonly string[]).includes(rawType)
    ? rawType
    : normalizePropertyType(rawType) || "Others";

  const numbers: Record<string, number | null> = {};
  for (const field of NUMERIC_FIELDS) {
    const value = body[field];
    numbers[field] =
      typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  }

  const price = listingType === "Rent" ? numbers.rent_per_month || 0 : numbers.price || 0;

  const db = denAdmin();
  const { data: prop, error } = await db
    .from("properties")
    .insert({
      account_id: link.accountId,
      user_id: null,
      title: title.slice(0, 200),
      description:
        typeof body.description === "string"
          ? body.description.slice(0, 5000)
          : "Listed by the owner via Owners Den, pending review.",
      price,
      location: location.slice(0, 300),
      type,
      status: "Pending Review",
      listing_type: listingType,
      rent_per_month: numbers.rent_per_month,
      maintenance: numbers.maintenance,
      advance: numbers.advance,
      gst: numbers.gst,
      bedrooms: numbers.bedrooms,
      bathrooms: numbers.bathrooms,
      area_sqft: numbers.area_sqft,
      land_area: numbers.land_area,
      sublocality: typeof body.sublocality === "string" ? body.sublocality.slice(0, 200) : null,
      city: typeof body.city === "string" && body.city.trim() ? body.city.slice(0, 100) : "Bangalore",
      state: typeof body.state === "string" && body.state.trim() ? body.state.slice(0, 100) : "Karnataka",
      is_published: false,
      features: Array.isArray(body.features) ? body.features.filter((f) => typeof f === "string").slice(0, 40) : [],
      nearby_highlights: Array.isArray(body.nearby_highlights)
        ? body.nearby_highlights.filter((f) => typeof f === "string").slice(0, 40)
        : [],
      images: [],
      owner_contact_id: link.contactId,
      listing_source: "owner",
    })
    .select(DEN_PROPERTY_SELECT)
    .single();

  if (error || !prop) {
    console.error("[den/properties POST] insert failed:", error);
    return NextResponse.json({ error: "Could not save your listing" }, { status: 500 });
  }

  return NextResponse.json({ property: prop }, { status: 201 });
});
