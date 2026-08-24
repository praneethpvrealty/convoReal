// ============================================================
// /api/beta-invites
//
//   GET  — the calling account's own seats and their status.
//   POST — spend one seat, returning the link exactly once.
//
// Both admin+. This is what Settings → Invites renders.
//
// The plaintext token is returned ONLY in the POST response. The row
// stores the SHA-256 hash, so GET can never resurface a link — same
// discipline as team invites. If the admin closes the dialog without
// copying, the recourse is revoke and re-issue.
//
// Quota is enforced inside issue_beta_invite() (migration 188), not
// here: it has to be atomic with the insert or two concurrent
// requests race past the 5-seat limit.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { inviteBaseUrl } from "@/lib/auth/invite-base-url";
import {
  betaInviteShareMessage,
  betaInviteUrl,
  generateBetaInvite,
} from "@/lib/beta/invites";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const MAX_LABEL_LEN = 80;

/** Shape returned by beta_program_public() (migration 188). */
interface BetaProgram {
  account_cap: number;
  default_quota: number;
  invite_ttl_days: number;
  issuance_open: boolean;
  program_ends_at: string | null;
  seats_taken: number;
}

/** Mirrors the SQLSTATE contract documented on issue_beta_invite(). */
function rpcErrorToResponse(err: PostgrestError, tag: string): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  console.error(`[${tag}] unexpected RPC error:`, err);
  return NextResponse.json(
    { error: "Failed to issue invitation" },
    { status: 500 },
  );
}

export async function GET() {
  try {
    const ctx = await requireRole("admin");

    const [invites, program, quota] = await Promise.all([
      ctx.supabase
        .from("beta_invites")
        .select(
          "id, code, label, status, generation, invitee_phone, invitee_email, created_at, expires_at, accepted_at, seat_number",
        )
        .eq("issued_by_account_id", ctx.accountId)
        .neq("status", "revoked")
        .order("created_at", { ascending: false }),
      ctx.supabase.rpc("beta_program_public"),
      ctx.supabase
        .from("accounts")
        .select("invite_quota")
        .eq("id", ctx.accountId)
        .maybeSingle(),
    ]);

    if (invites.error) {
      console.error("[GET /api/beta-invites] fetch error:", invites.error);
      return NextResponse.json(
        { error: "Failed to load invitations" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      invites: invites.data ?? [],
      quota: quota.data?.invite_quota ?? 5,
      used: (invites.data ?? []).length,
      program: (program.data as BetaProgram | null) ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = await checkRateLimit(
      `beta:invite:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    let label: string | null = null;
    let inviteePhone: string | null = null;
    let inviteeEmail: string | null = null;
    try {
      const body = (await request.json()) as {
        label?: unknown;
        invitee_phone?: unknown;
        invitee_email?: unknown;
      };
      if (typeof body.label === "string") {
        label = body.label.trim().slice(0, MAX_LABEL_LEN) || null;
      }
      if (typeof body.invitee_phone === "string") {
        inviteePhone = body.invitee_phone.trim() || null;
      }
      if (typeof body.invitee_email === "string") {
        inviteeEmail = body.invitee_email.trim() || null;
      }
    } catch {
      // Body is optional — a seat with no label is fine.
    }

    const { token, hash, code } = generateBetaInvite();

    const { data, error } = await ctx.supabase.rpc("issue_beta_invite", {
      p_token_hash: hash,
      p_code: code,
      p_label: label,
      p_invitee_phone: inviteePhone,
      p_invitee_email: inviteeEmail,
    });

    if (error) return rpcErrorToResponse(error, "POST /api/beta-invites");

    const issued = data as {
      id: string;
      expires_at: string;
      used?: number;
      quota?: number;
    };

    const url = betaInviteUrl(
      token,
      inviteBaseUrl(request, "POST /api/beta-invites"),
    );

    const [{ data: program }, { data: profile }] = await Promise.all([
      ctx.supabase.rpc("beta_program_public"),
      ctx.supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", ctx.userId)
        .maybeSingle(),
    ]);

    const prog = program as BetaProgram | null;
    const seatsRemaining = prog
      ? Math.max(0, prog.account_cap - prog.seats_taken)
      : null;

    const expiryDays = Math.max(
      1,
      Math.round(
        (new Date(issued.expires_at).getTime() - Date.now()) / 86_400_000,
      ),
    );

    return NextResponse.json({
      id: issued.id,
      code,
      // Returned exactly once. Never retrievable again.
      url,
      shareMessage: betaInviteShareMessage({
        url,
        inviterName: profile?.full_name || null,
        seatsRemaining,
        expiryDays,
      }),
      expiresAt: issued.expires_at,
      used: issued.used ?? null,
      quota: issued.quota ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
