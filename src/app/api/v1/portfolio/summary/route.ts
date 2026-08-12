// ============================================================
// GET /api/v1/portfolio/summary — both Portfolio rollups in one call.
//
// "How much of my owners' stock is still for sale" and "what is my
// buyers' average budget" are usually asked together, and each is a
// single aggregate — two round trips for two numbers would be waste.
//
// Scoping is inside the RPCs (migration 257): each enters through
// den_contact_links / buyer_contact_links filtered to this account, so
// a portal user this account has not linked is unreachable here even
// though the identity tables themselves are global.
// ============================================================

import { NextResponse } from "next/server";

import { withApiKeyAuth } from "@/lib/auth/api-keys";
import { asRow } from "@/lib/v1/projections";
import { toBuyerStats, toOwnerStats } from "@/lib/v1/portfolio";

export const GET = withApiKeyAuth("read", async (ctx) => {
  const [owners, buyers] = await Promise.all([
    ctx.db.rpc("portfolio_owner_stats", { p_account_id: ctx.accountId }).maybeSingle(),
    ctx.db.rpc("portfolio_buyer_stats", { p_account_id: ctx.accountId }).maybeSingle(),
  ]);

  if (owners.error) {
    console.error("[GET /api/v1/portfolio/summary] owner stats error:", owners.error);
    return NextResponse.json({ error: "Failed to load owner portfolio" }, { status: 500 });
  }
  if (buyers.error) {
    console.error("[GET /api/v1/portfolio/summary] buyer stats error:", buyers.error);
    return NextResponse.json({ error: "Failed to load buyer portfolio" }, { status: 500 });
  }

  return NextResponse.json({
    owners: toOwnerStats(owners.data ? asRow(owners.data) : null),
    buyers: toBuyerStats(buyers.data ? asRow(buyers.data) : null),
  });
});
