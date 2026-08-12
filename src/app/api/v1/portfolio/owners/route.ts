// ============================================================
// GET /api/v1/portfolio/owners — this account's owners who have a
// Portfolio login, with the stock each of them holds.
//
// Ranked by live stock, so the owners with the most sellable inventory
// lead. Agent-referred listings are excluded from every count:
// owner_contact_id holds the REFERRING AGENT on those (migration 191),
// and crediting them to that agent as an owner would be wrong.
// ============================================================

import { NextResponse } from "next/server";

import { withApiKeyAuth } from "@/lib/auth/api-keys";
import { page, parsePageParams } from "@/lib/v1/pagination";
import { asRows } from "@/lib/v1/projections";
import { toOwnerRow, totalFromRows } from "@/lib/v1/portfolio";

export const GET = withApiKeyAuth("read", async (ctx, req) => {
  const params = parsePageParams(new URL(req.url));

  const { data, error } = await ctx.db.rpc("portfolio_owner_rows", {
    p_account_id: ctx.accountId,
    p_limit: params.limit,
    p_offset: params.offset,
  });

  if (error) {
    console.error("[GET /api/v1/portfolio/owners] rpc error:", error);
    return NextResponse.json({ error: "Failed to load Portfolio owners" }, { status: 500 });
  }

  const rows = asRows(data);
  return NextResponse.json(page(rows.map(toOwnerRow), params, totalFromRows(rows)));
});
