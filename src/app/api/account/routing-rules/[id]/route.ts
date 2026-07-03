// ============================================================
// /api/account/routing-rules/[id]
//
//   PATCH  — toggle is_active, change priority/match_value/targets.
//   DELETE — remove a rule.
//
// Both Org Manager only — see route.ts in the parent directory.
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
    if (ctx.orgRole !== "org_manager") {
      return NextResponse.json(
        { error: "This action requires the Org Manager role" },
        { status: 403 },
      );
    }

    const limit = checkRateLimit(
      `manager:updateRoutingRule:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as
      | {
          matchValue?: unknown;
          targetTeamId?: unknown;
          targetAgentId?: unknown;
          priority?: unknown;
          isActive?: unknown;
        }
      | null;

    const updateData: Record<string, unknown> = {};
    if (body?.matchValue !== undefined) {
      updateData.match_value = typeof body.matchValue === "string" ? body.matchValue.trim() : null;
    }
    if (body?.targetTeamId !== undefined) {
      updateData.target_team_id = typeof body.targetTeamId === "string" ? body.targetTeamId : null;
    }
    if (body?.targetAgentId !== undefined) {
      updateData.target_agent_id = typeof body.targetAgentId === "string" ? body.targetAgentId : null;
    }
    if (typeof body?.priority === "number") {
      updateData.priority = body.priority;
    }
    if (typeof body?.isActive === "boolean") {
      updateData.is_active = body.isActive;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from("routing_rules")
      .update(updateData)
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select()
      .maybeSingle();

    if (error) {
      console.error("[PATCH /api/account/routing-rules/[id]] update error:", error);
      return NextResponse.json({ error: "Failed to update routing rule" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Routing rule not found" }, { status: 404 });
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
      `manager:deleteRoutingRule:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const { error } = await ctx.supabase
      .from("routing_rules")
      .delete()
      .eq("id", id)
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[DELETE /api/account/routing-rules/[id]] delete error:", error);
      return NextResponse.json({ error: "Failed to delete routing rule" }, { status: 500 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
