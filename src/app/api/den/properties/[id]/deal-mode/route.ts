// ============================================================
// PUT /api/den/properties/[id]/deal-mode — the owner's sell-readiness
// switch (Off / Soft / Aggressive), changeable any time.
//
// Phase 1 stores the flag; the Phase 2 matching sweep
// (/api/cron/deal-mode-matching) picks up soft/aggressive properties
// on its next run, and an owner flipping straight to aggressive gets
// an immediate sweep for that property.
// ============================================================

import { NextResponse } from "next/server";

import { UserFacingError } from "@/lib/auth/account";
import { withDenAuth, denAdmin } from "@/lib/den/auth";
import { DEAL_MODES, loadOwnedProperty, type DealMode } from "@/lib/den/properties";

export const PUT = withDenAuth(async (ctx, req, routeCtx) => {
  const { id } = await routeCtx.params;
  const existing = await loadOwnedProperty(ctx, id);
  if (!existing) throw new UserFacingError("Property not found", 404);

  const body = (await req.json().catch(() => null)) as { deal_mode?: unknown } | null;
  const dealMode = body?.deal_mode as DealMode | undefined;
  if (!dealMode || !DEAL_MODES.includes(dealMode)) {
    throw new UserFacingError("deal_mode must be one of: off, soft, aggressive");
  }

  const db = denAdmin();
  const { error } = await db
    .from("properties")
    .update({
      deal_mode: dealMode,
      deal_mode_updated_at: new Date().toISOString(),
      deal_mode_set_by: "owner",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    console.error("[den deal-mode PUT] update failed:", error);
    return NextResponse.json({ error: "Could not update Deal Mode" }, { status: 500 });
  }

  return NextResponse.json({
    property_id: id,
    deal_mode: dealMode,
    was: existing.deal_mode ?? "off",
  });
});
