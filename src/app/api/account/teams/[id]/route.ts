// ============================================================
// /api/account/teams/[id]
//
//   PATCH  — rename a team, or set/clear its leader. Org Leader+
//            (a Leader can only edit their OWN team — enforced by
//            the teams_update RLS policy's `leader_id = auth.uid()`
//            branch, not re-checked here).
//   DELETE — delete a team. Org Manager only (matches the design
//            doc: Leaders manage their team's roster, not the
//            team's existence).
//
// Writes go straight through ctx.supabase (RLS-scoped) — see
// route.ts in the parent directory for why teams don't need an RPC.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
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
      `leader:updateTeam:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; leaderId?: unknown }
      | null;

    const updateData: Record<string, unknown> = {};
    if (body?.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length === 0) {
        return NextResponse.json({ error: "'name' cannot be empty" }, { status: 400 });
      }
      updateData.name = body.name.trim();
    }
    if (body?.leaderId !== undefined) {
      if (body.leaderId !== null && typeof body.leaderId !== "string") {
        return NextResponse.json(
          { error: "'leaderId' must be a string or null" },
          { status: 400 },
        );
      }
      updateData.leader_id = body.leaderId;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    // RLS (teams_update) enforces the real authority check: admin+
    // account-wide, or the team's own leader. A Leader trying to edit
    // another team simply gets zero rows updated below.
    const { data, error } = await ctx.supabase
      .from("teams")
      .update(updateData)
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select()
      .maybeSingle();

    if (error) {
      console.error("[PATCH /api/account/teams/[id]] update error:", error);
      return NextResponse.json({ error: "Failed to update team" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: "Team not found or you don't have permission to edit it" },
        { status: 404 },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    if (ctx.orgRole !== "org_manager") {
      return NextResponse.json(
        { error: "This action requires the Org Manager role" },
        { status: 403 },
      );
    }

    const limit = checkRateLimit(
      `manager:deleteTeam:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const { error } = await ctx.supabase
      .from("teams")
      .delete()
      .eq("id", id)
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[DELETE /api/account/teams/[id]] delete error:", error);
      return NextResponse.json({ error: "Failed to delete team" }, { status: 500 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
