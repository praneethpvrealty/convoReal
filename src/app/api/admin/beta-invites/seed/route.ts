// ============================================================
// POST /api/admin/beta-invites/seed — mint generation-0 seeds.
//
// Super-admin only. Seeds have no issuing account and spend nobody's
// quota, which is exactly why this is gated harder than the tenant
// endpoint: it is the only way to create an invite from nothing.
//
// The plan calls for ~17 seeds to put 17 accounts on the board on
// day one regardless of anyone's enthusiasm, with a handful held
// back to issue in week three against the actual shortfall. This
// endpoint mints them in one call and returns every link once.
// ============================================================

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { inviteBaseUrl } from "@/lib/auth/invite-base-url";
import {
  betaInviteShareMessage,
  betaInviteUrl,
  generateBetaInvite,
} from "@/lib/beta/invites";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Bounded so a typo'd loop can't mint hundreds of live links. */
const MAX_SEEDS_PER_CALL = 25;

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

export async function POST(request: Request) {
  const supabase = await createClient();
  const guard = await requireSuperAdmin(supabase);
  if (!guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status });
  }

  let labels: string[] = [];
  let count = 1;
  try {
    const body = (await request.json()) as {
      labels?: unknown;
      count?: unknown;
    };
    if (Array.isArray(body.labels)) {
      labels = body.labels
        .filter((l): l is string => typeof l === "string")
        .map((l) => l.trim().slice(0, 80))
        .filter(Boolean);
    }
    if (typeof body.count === "number" && Number.isFinite(body.count)) {
      count = Math.floor(body.count);
    }
  } catch {
    // No body — mint a single unlabelled seed.
  }

  // Labels win when both are given: a named list is a more specific
  // instruction than a bare count.
  const total = labels.length > 0 ? labels.length : count;
  if (total < 1) {
    return NextResponse.json(
      { error: "Nothing to mint — pass `count` or `labels`" },
      { status: 400 },
    );
  }
  if (total > MAX_SEEDS_PER_CALL) {
    return NextResponse.json(
      { error: `Refusing to mint more than ${MAX_SEEDS_PER_CALL} seeds at once` },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  const base = inviteBaseUrl(request, "POST /api/admin/beta-invites/seed");
  const { data: program } = await admin.rpc("beta_program_public");
  const prog = program as {
    account_cap: number;
    seats_taken: number;
    invite_ttl_days: number;
  } | null;

  const minted: Array<{
    id: string;
    code: string;
    label: string | null;
    url: string;
    shareMessage: string;
    expiresAt: string;
  }> = [];

  for (let i = 0; i < total; i++) {
    const label = labels[i] ?? null;
    const { token, hash, code } = generateBetaInvite();

    const { data, error } = await admin.rpc("issue_beta_seed", {
      p_token_hash: hash,
      p_code: code,
      p_label: label,
      p_invitee_phone: null,
      p_invitee_email: null,
    });

    if (error) {
      console.error("[POST /api/admin/beta-invites/seed] RPC error:", error);
      // Partial success is reported rather than swallowed — the seeds
      // already minted are live links and the caller has to know.
      return NextResponse.json(
        {
          error: error.message,
          minted,
          mintedCount: minted.length,
          requested: total,
        },
        { status: 500 },
      );
    }

    const issued = data as { id: string; expires_at: string };
    const url = betaInviteUrl(token, base);

    minted.push({
      id: issued.id,
      code,
      label,
      url,
      shareMessage: betaInviteShareMessage({
        url,
        inviterName: null,
        inviteeName: label,
        seatsRemaining: prog
          ? Math.max(0, prog.account_cap - prog.seats_taken)
          : null,
        expiryDays: prog?.invite_ttl_days ?? 14,
      }),
      expiresAt: issued.expires_at,
    });
  }

  return NextResponse.json({ minted, mintedCount: minted.length });
}
