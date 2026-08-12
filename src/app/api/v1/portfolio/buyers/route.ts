// ============================================================
// GET /api/v1/portfolio/buyers — this account's buyers who have a
// Portfolio login, with their budget, brief and shortlist size.
//
// Ranked by budget, highest first, which is the order an agent
// working the list actually wants. Budget comes from the linked
// CONTACT rather than the portal user: the portal is a view onto the
// agency's own record, and the matching engine reads the same columns,
// so the number here is the number that drives matches.
// ============================================================

import { NextResponse } from "next/server";

import { withApiKeyAuth } from "@/lib/auth/api-keys";
import { page, parsePageParams } from "@/lib/v1/pagination";
import { asRows } from "@/lib/v1/projections";
import { toBuyerRow, totalFromRows } from "@/lib/v1/portfolio";

export const GET = withApiKeyAuth("read", async (ctx, req) => {
  const params = parsePageParams(new URL(req.url));

  const { data, error } = await ctx.db.rpc("portfolio_buyer_rows", {
    p_account_id: ctx.accountId,
    p_limit: params.limit,
    p_offset: params.offset,
  });

  if (error) {
    console.error("[GET /api/v1/portfolio/buyers] rpc error:", error);
    return NextResponse.json({ error: "Failed to load Portfolio buyers" }, { status: 500 });
  }

  const rows = asRows(data);
  return NextResponse.json(page(rows.map(toBuyerRow), params, totalFromRows(rows)));
});
