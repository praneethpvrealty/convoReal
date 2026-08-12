// ============================================================
// GET /api/v1/contacts/[id] — one contact, with their stated brief.
// ============================================================

import { NextResponse } from "next/server";

import { withApiKeyAuth } from "@/lib/auth/api-keys";
import { asRow, CONTACT_COLUMNS, toV1ContactDetail } from "@/lib/v1/projections";

const DETAIL_COLUMNS = `${CONTACT_COLUMNS}, strict_area_match, strict_project_match`;

export const GET = withApiKeyAuth("read", async (ctx, _req, routeCtx) => {
  const { id } = await routeCtx.params;

  const { data, error } = await ctx.db
    .from("contacts")
    .select(DETAIL_COLUMNS)
    .eq("account_id", ctx.accountId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[GET /api/v1/contacts/[id]] query error:", error);
    return NextResponse.json({ error: "Failed to load contact" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Contact not found", code: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ contact: toV1ContactDetail(asRow(data)) });
});
