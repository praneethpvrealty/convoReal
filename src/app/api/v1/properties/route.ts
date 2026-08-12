// ============================================================
// GET /api/v1/properties — search this account's inventory.
//
// API-key authenticated (read scope). `ctx.db` is the service-role
// client, so the `.eq('account_id', ctx.accountId)` below is the ONLY
// thing keeping one tenant's inventory out of another's results —
// see src/lib/auth/api-keys.ts.
//
// Filters are the ones an agent actually asks about: free text, price
// band, bedrooms, type, city, listing type, status. Anything absent
// simply is not filtered.
// ============================================================

import { NextResponse } from "next/server";

import { withApiKeyAuth } from "@/lib/auth/api-keys";
import { page, parsePageParams } from "@/lib/v1/pagination";
import { asRows, PROPERTY_COLUMNS, toV1Property } from "@/lib/v1/projections";
import { boolParam, enumParam, ilikeAcross, ilikeTerm, numParam } from "@/lib/v1/query";

const SEARCH_COLUMNS = ["title", "location", "sublocality", "city", "project"];

const LISTING_TYPES = ["Sale", "Rent", "JV/JD", "Built to Suit"] as const;

const SORTS = {
  recent: { column: "updated_at", ascending: false },
  oldest: { column: "created_at", ascending: true },
  price_asc: { column: "price", ascending: true },
  price_desc: { column: "price", ascending: false },
} as const;

export const GET = withApiKeyAuth("read", async (ctx, req) => {
  const url = new URL(req.url);
  const params = parsePageParams(url);

  let query = ctx.db
    .from("properties")
    .select(PROPERTY_COLUMNS, { count: "exact" })
    .eq("account_id", ctx.accountId);

  const raw = url.searchParams.get("q");
  if (raw) {
    const term = ilikeTerm(raw);
    if (term) query = query.or(ilikeAcross(SEARCH_COLUMNS, term));
  }

  const status = url.searchParams.get("status")?.trim();
  if (status) query = query.eq("status", status);

  const type = url.searchParams.get("type")?.trim();
  if (type) query = query.eq("type", type);

  const city = url.searchParams.get("city")?.trim();
  if (city) {
    const term = ilikeTerm(city);
    if (term) query = query.ilike("city", `%${term}%`);
  }

  const listingType = enumParam(url, "listing_type", LISTING_TYPES);
  if (listingType) query = query.eq("listing_type", listingType);

  const minPrice = numParam(url, "min_price");
  if (minPrice !== null) query = query.gte("price", minPrice);

  const maxPrice = numParam(url, "max_price");
  if (maxPrice !== null) query = query.lte("price", maxPrice);

  const bedrooms = numParam(url, "bedrooms");
  if (bedrooms !== null) query = query.eq("bedrooms", bedrooms);

  const published = boolParam(url, "published");
  if (published !== null) query = query.eq("is_published", published);

  const sort = enumParam(url, "sort", Object.keys(SORTS) as (keyof typeof SORTS)[]) ?? "recent";
  const { column, ascending } = SORTS[sort];

  const { data, error, count } = await query
    .order(column, { ascending, nullsFirst: false })
    .range(params.offset, params.offset + params.limit - 1);

  if (error) {
    console.error("[GET /api/v1/properties] query error:", error);
    return NextResponse.json({ error: "Failed to search properties" }, { status: 500 });
  }

  return NextResponse.json(page(asRows(data).map(toV1Property), params, count ?? null));
});
