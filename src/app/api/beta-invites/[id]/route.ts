// ============================================================
// DELETE /api/beta-invites/[id] — revoke an unclaimed seat.
//
// Admin+. Frees the seat back into the account's quota.
//
// Ownership and the "not already claimed" rule are enforced inside
// revoke_beta_invite() (migration 188) under a row lock, not here —
// checking in the route would race a concurrent redemption.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  console.error("[DELETE /api/beta-invites/[id]] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to revoke invitation" },
    { status: 500 },
  );
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = await checkRateLimit(
      `beta:revoke:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { error: "Missing invitation id" },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase.rpc("revoke_beta_invite", {
      p_id: id,
    });
    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
