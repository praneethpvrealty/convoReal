// ============================================================
// /api/account/members/[userId]/team
//
//   PATCH — assign a member into a team, or remove them (teamId: null).
//
// Delegates to the SECURITY DEFINER RPC from migration 084:
//   - set_member_team(p_user_id, p_team_id)
//
// The RPC does the real authorisation work: caller must be Org
// Leader+, target must be in caller's account, and a Leader can
// only move Org Agents into their own team. This route only
// forwards the call and maps Postgres SQLSTATEs to HTTP statuses.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[member team route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update member's team" },
    { status: 500 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    if (ctx.orgRole !== "org_manager" && ctx.orgRole !== "org_leader") {
      return NextResponse.json(
        { error: "This action requires the Org Leader role or higher" },
        { status: 403 },
      );
    }

    const limit = checkRateLimit(
      `leader:memberTeam:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { teamId?: unknown }
      | null;
    const teamId = body?.teamId;

    if (teamId !== null && typeof teamId !== "string") {
      return NextResponse.json(
        { error: "'teamId' must be a string or null" },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase.rpc("set_member_team", {
      p_user_id: userId,
      p_team_id: teamId,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
