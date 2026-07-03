// ============================================================
// /api/account/teams
//
//   GET  — list every team in the caller's account. Any member can
//          call it (read-only roster, same visibility rule as
//          /api/account/members).
//   POST — create a team. Org Leader+, gated on the account's
//          has_teams plan flag (Team/Agency plans).
//
// Team writes go straight through ctx.supabase (RLS-scoped) rather
// than an RPC — the teams RLS policies from migration 082 already
// let any admin+ (org_leader+) member write directly, unlike
// profiles.team_id which needs the set_member_team RPC (profiles'
// RLS only allows self-updates).
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { getPlanLimits } from "@/lib/billing/gates";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from("teams")
      .select("*")
      .eq("account_id", ctx.accountId)
      .order("name", { ascending: true });

    if (error) {
      console.error("[GET /api/account/teams] fetch error:", error);
      return NextResponse.json({ error: "Failed to load teams" }, { status: 500 });
    }

    return NextResponse.json({ teams: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    if (ctx.orgRole !== "org_manager" && ctx.orgRole !== "org_leader") {
      return NextResponse.json(
        { error: "This action requires the Org Leader role or higher" },
        { status: 403 },
      );
    }

    const limits = await getPlanLimits(ctx);
    if (!limits.has_teams) {
      return NextResponse.json(
        {
          error: "Teams require the Team plan or higher",
          upgradeRequired: "team",
        },
        { status: 402 },
      );
    }

    const limit = checkRateLimit(
      `leader:createTeam:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
    const name = body?.name;
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "'name' is required" }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from("teams")
      .insert({ account_id: ctx.accountId, name: name.trim() })
      .select()
      .single();

    if (error) {
      console.error("[POST /api/account/teams] insert error:", error);
      return NextResponse.json({ error: "Failed to create team" }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
