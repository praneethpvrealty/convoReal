// ============================================================
// /api/admin/bug-reports — cross-tenant triage.
//
//   GET   — every beta account's reports, newest first.
//   PATCH — set status / admin notes / a linked GitHub issue.
//
// Super-admin only, service-role client. bug_reports RLS scopes a
// tenant to their own rows by design, so platform-wide triage can't
// go through it — this route is the deliberate exception, and the
// super_admin check IS the boundary here.
// ============================================================

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isBugStatus } from "@/lib/beta/bug-reports";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function requireSuperAdmin(supabase: SupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false as const, status: 401, body: { error: "Unauthorized" } };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profile?.role !== "super_admin") {
    return { ok: false as const, status: 403, body: { error: "Forbidden" } };
  }
  return { ok: true as const };
}

export async function GET() {
  const supabase = await createClient();
  const guard = await requireSuperAdmin(supabase);
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const { data, error } = await supabaseAdmin()
    .from("bug_reports")
    .select(
      "id, reference, title, body, severity, status, page_url, build_id, user_agent, admin_notes, github_issue_url, created_at, account_id, accounts(name)",
    )
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    console.error("[GET /api/admin/bug-reports] fetch error:", error);
    return NextResponse.json(
      { error: "Failed to load bug reports" },
      { status: 500 },
    );
  }

  return NextResponse.json({ reports: data ?? [] });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const guard = await requireSuperAdmin(supabase);
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  let payload: {
    id?: unknown;
    status?: unknown;
    admin_notes?: unknown;
    github_issue_url?: unknown;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof payload.id !== "string" || !payload.id) {
    return NextResponse.json({ error: "Missing report id" }, { status: 400 });
  }

  const patch: Record<string, string | null> = {};
  if (payload.status !== undefined) {
    if (!isBugStatus(payload.status)) {
      return NextResponse.json({ error: "Unknown status" }, { status: 400 });
    }
    patch.status = payload.status;
  }
  if (typeof payload.admin_notes === "string") {
    patch.admin_notes = payload.admin_notes.slice(0, 5_000) || null;
  }
  if (typeof payload.github_issue_url === "string") {
    patch.github_issue_url = payload.github_issue_url.slice(0, 500) || null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await supabaseAdmin()
    .from("bug_reports")
    .update(patch)
    .eq("id", payload.id);

  if (error) {
    console.error("[PATCH /api/admin/bug-reports] update error:", error);
    return NextResponse.json(
      { error: "Failed to update the report" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
