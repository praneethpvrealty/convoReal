// ============================================================
// /api/bug-reports
//
//   GET  — this account's own reports (any member).
//   POST — file one (agent+).
//
// The client sends what happened and how bad; page_url, build_id and
// user_agent are attached silently. Asking a beta tester to fill in
// four fields is how you get zero reports.
//
// build_id is the field that makes a report actionable a week later:
// "it broke on Tuesday" isn't a bug report, a commit SHA is. It's
// trusted from the client because it is diagnostic, not a control —
// a forged value degrades one report, nothing else.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  deriveTitle,
  generateBugReference,
  isBugSeverity,
} from "@/lib/beta/bug-reports";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const MAX_BODY_LEN = 5_000;
const MAX_URL_LEN = 500;
const MAX_UA_LEN = 400;

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from("bug_reports")
      .select(
        "id, reference, title, body, severity, status, page_url, build_id, github_issue_url, created_at, updated_at",
      )
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("[GET /api/bug-reports] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load bug reports" },
        { status: 500 },
      );
    }

    return NextResponse.json({ reports: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");

    const limit = checkRateLimit(
      `bug-report:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    let payload: {
      body?: unknown;
      title?: unknown;
      severity?: unknown;
      page_url?: unknown;
      build_id?: unknown;
    };
    try {
      payload = (await request.json()) as typeof payload;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const body =
      typeof payload.body === "string" ? payload.body.trim().slice(0, MAX_BODY_LEN) : "";
    if (!body) {
      return NextResponse.json(
        { error: "Tell us what happened" },
        { status: 400 },
      );
    }

    const title =
      typeof payload.title === "string" && payload.title.trim()
        ? payload.title.trim().slice(0, 200)
        : deriveTitle(body);

    const severity = isBugSeverity(payload.severity) ? payload.severity : "minor";

    const { data, error } = await ctx.supabase
      .from("bug_reports")
      .insert({
        account_id: ctx.accountId,
        reported_by_user_id: ctx.userId,
        reference: generateBugReference(),
        title,
        body,
        severity,
        page_url:
          typeof payload.page_url === "string"
            ? payload.page_url.slice(0, MAX_URL_LEN)
            : null,
        build_id:
          typeof payload.build_id === "string"
            ? payload.build_id.slice(0, 80)
            : null,
        user_agent:
          request.headers.get("user-agent")?.slice(0, MAX_UA_LEN) ?? null,
      })
      .select("id, reference")
      .single();

    if (error) {
      console.error("[POST /api/bug-reports] insert error:", error);
      return NextResponse.json(
        { error: "Failed to file the report" },
        { status: 500 },
      );
    }

    return NextResponse.json({ id: data.id, reference: data.reference });
  } catch (err) {
    return toErrorResponse(err);
  }
}
