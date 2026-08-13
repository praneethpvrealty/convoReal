// ============================================================
// DELETE /api/account/api-keys/[id]
//
// Admin+. Revokes a key by id. RLS on `account_api_keys` already
// restricts the UPDATE to admins of the owning account, so there is no
// explicit ownership check here — same reasoning as the invitation
// revoke route.
//
// Unlike an invitation, a key is soft-revoked rather than deleted. The
// row is the only record that an integration ever existed; keeping it
// (with `revoked_at` and `last_used_at`) lets an admin answer "what was
// this key, and when did it stop being used" after the fact. The
// verification path filters on `revoked_at IS NULL`, so a revoked row
// is dead immediately.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("admin");

    const limit = await checkRateLimit(`admin:apiKeyRevoke:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from("account_api_keys")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by_user_id: ctx.userId,
      })
      .eq("id", id)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[DELETE /api/account/api-keys/[id]] error:", error);
      return NextResponse.json({ error: "Failed to revoke API key" }, { status: 500 });
    }

    if (!data) {
      // Missing, already revoked, or hidden by RLS (another account).
      // 404 for all three — distinguishing them would leak existence.
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
