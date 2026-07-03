// ============================================================
// /api/account/members/[userId]/org-role
//
//   PATCH — promote an agent to leader, or demote a leader back
//           to agent. Org Manager only.
//
// Delegates to the SECURITY DEFINER RPC from migration 083:
//   - set_member_org_role(p_user_id, p_new_role)
//
// The RPC does the *real* authorisation work (caller must be Org
// Manager, target must be in caller's account, can't target the
// Manager themselves, can't target self). This route only forwards
// the call and maps Postgres SQLSTATEs back to HTTP statuses, same
// pattern as /api/account/members/[userId].
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { isOrgRole } from "@/lib/auth/roles";
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
  console.error("[org-role route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update member's org role" },
    { status: 500 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    // Manager-only — checked against orgRole directly (not the legacy
    // requireRole helper) since this is a new org-hierarchy action.
    const ctx = await getCurrentAccount();
    if (ctx.orgRole !== "org_manager") {
      return NextResponse.json(
        { error: "This action requires the Org Manager role" },
        { status: 403 },
      );
    }

    const limit = checkRateLimit(
      `manager:memberOrgRole:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown }
      | null;
    const role = body?.role;

    if (!isOrgRole(role) || role === "org_manager") {
      return NextResponse.json(
        { error: "'role' must be one of org_leader, org_agent" },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase.rpc("set_member_org_role", {
      p_user_id: userId,
      p_new_role: role,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
