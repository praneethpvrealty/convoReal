// ============================================================
// GET /api/v1/properties/[id] — one listing, in full.
//
// The `.eq('account_id', ctx.accountId)` is load-bearing: without it a
// caller holding any account's key could read any listing by id.
// ============================================================

import { NextResponse } from "next/server";

import { withApiKeyAuth } from "@/lib/auth/api-keys";
import { asRow, PROPERTY_COLUMNS, toV1PropertyDetail } from "@/lib/v1/projections";

const DETAIL_COLUMNS = `${PROPERTY_COLUMNS}, description`;

export const GET = withApiKeyAuth("read", async (ctx, _req, routeCtx) => {
  const { id } = await routeCtx.params;

  const { data, error } = await ctx.db
    .from("properties")
    .select(DETAIL_COLUMNS)
    .eq("account_id", ctx.accountId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[GET /api/v1/properties/[id]] query error:", error);
    return NextResponse.json({ error: "Failed to load property" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Property not found", code: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ property: toV1PropertyDetail(asRow(data)) });
});
