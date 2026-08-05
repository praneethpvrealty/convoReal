// ============================================================
// GET /api/beta-invites/[id]/peek
//
// Anonymous. Backs the /i/<token> landing page: who invited you,
// how many seats are left, when the link dies.
//
// The dynamic segment is named [id] only because Next.js requires a
// single param name per path level and the sibling DELETE route owns
// [id]; the value carried here is the plaintext invite token, so the
// handler rebinds it as `token` immediately.
//
// Mirrors peek_invitation (019) — a uniform `{ ok, reason? }`
// envelope so the page never has to interpret a Postgres error, and
// a per-IP rate limit reusing RATE_LIMITS.invitationPeek.
//
// The plaintext token never reaches the database: it is hashed here
// and looked up by hash, so a leaked DB snapshot can't be replayed.
// ============================================================

import { NextResponse } from "next/server";

import { hashInviteToken } from "@/lib/beta/invites";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const limit = checkRateLimit(
    `beta-peek:${getClientIp(request)}`,
    RATE_LIMITS.invitationPeek,
  );
  if (!limit.success) return rateLimitResponse(limit);

  const { id: token } = await params;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ ok: false, reason: "not_found" });
  }

  // Service role because the caller is anonymous and beta_invites has
  // no anon SELECT policy. peek_beta_invite() is SECURITY DEFINER and
  // returns only the fields the page may show — the token hash, the
  // issuing account id and the invitee contact details never leave
  // the server.
  const { data, error } = await supabaseAdmin().rpc("peek_beta_invite", {
    p_token_hash: hashInviteToken(token),
  });

  if (error) {
    console.error("[GET /api/beta-invites/[id]/peek] RPC error:", error);
    return NextResponse.json({ ok: false, reason: "server_error" });
  }

  return NextResponse.json(data);
}
