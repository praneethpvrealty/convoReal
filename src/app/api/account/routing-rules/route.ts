// ============================================================
// /api/account/routing-rules
//
//   GET  — list every routing rule in the caller's account.
//   POST — create a rule. Org Manager only (matches the design doc:
//          "Set and modify routing rules" is a Manager-only
//          capability — Leaders configure their own team's roster,
//          not account-wide routing behaviour).
//
// Writes go straight through ctx.supabase (RLS-scoped) — the
// routing_rules_modify policy from migration 082 already restricts
// writes to admin+ (org_leader+ via the legacy-literal mapping), so
// this route additionally tightens to Manager-only per the design
// doc, on top of what RLS alone would allow.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import type { RoutingRuleType } from "@/types";

const RULE_TYPES: RoutingRuleType[] = [
  "locality_match",
  "source_match",
  "keyword_match",
  "round_robin",
  "fallback",
];

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from("routing_rules")
      .select("*")
      .eq("account_id", ctx.accountId)
      .order("priority", { ascending: true });

    if (error) {
      console.error("[GET /api/account/routing-rules] fetch error:", error);
      return NextResponse.json({ error: "Failed to load routing rules" }, { status: 500 });
    }

    return NextResponse.json({ rules: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    if (ctx.orgRole !== "org_manager") {
      return NextResponse.json(
        { error: "This action requires the Org Manager role" },
        { status: 403 },
      );
    }

    const limit = checkRateLimit(
      `manager:createRoutingRule:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | {
          ruleType?: unknown;
          matchValue?: unknown;
          targetTeamId?: unknown;
          targetAgentId?: unknown;
          priority?: unknown;
        }
      | null;

    const ruleType = body?.ruleType;
    if (typeof ruleType !== "string" || !RULE_TYPES.includes(ruleType as RoutingRuleType)) {
      return NextResponse.json(
        { error: `'ruleType' must be one of ${RULE_TYPES.join(", ")}` },
        { status: 400 },
      );
    }

    const targetTeamId = typeof body?.targetTeamId === "string" ? body.targetTeamId : null;
    const targetAgentId = typeof body?.targetAgentId === "string" ? body.targetAgentId : null;
    if (!targetTeamId && !targetAgentId) {
      return NextResponse.json(
        { error: "Either 'targetTeamId' or 'targetAgentId' is required" },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase
      .from("routing_rules")
      .insert({
        account_id: ctx.accountId,
        rule_type: ruleType,
        match_value: typeof body?.matchValue === "string" ? body.matchValue.trim() : null,
        target_team_id: targetTeamId,
        target_agent_id: targetAgentId,
        priority: typeof body?.priority === "number" ? body.priority : 100,
      })
      .select()
      .single();

    if (error) {
      console.error("[POST /api/account/routing-rules] insert error:", error);
      return NextResponse.json({ error: "Failed to create routing rule" }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
