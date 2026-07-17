// ============================================================
// POST /api/den/auth/complete — finish Owners Den sign-in.
//
// Called by the Den client after either login flow ends with a
// verified phone on the Supabase session:
//   * WhatsApp OTP login — phone verified inherently
//   * Google OAuth — after the /den/verify-phone phone_change OTP
//
// Upserts den_users and links the owner to matching contacts across
// all tenant accounts (see src/lib/den/linking.ts). Idempotent — the
// client calls it on every login so new agency relationships link up
// lazily.
// ============================================================

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { UnauthorizedError } from "@/lib/auth/account";
import { PhoneUnverifiedError, toDenErrorResponse } from "@/lib/den/auth";
import { completeDenAuth } from "@/lib/den/linking";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) throw new UnauthorizedError();

    const rate = checkRateLimit(`den-auth-complete:${user.id}`, {
      limit: 10,
      windowMs: 60_000,
    });
    if (!rate.success) return rateLimitResponse(rate);

    // The mandatory-WhatsApp gate: no verified phone, no Den.
    if (!user.phone || !user.phone_confirmed_at) {
      throw new PhoneUnverifiedError();
    }

    let displayName: string | null = null;
    try {
      const body = await request.json();
      if (typeof body?.display_name === "string") {
        displayName = body.display_name.trim().slice(0, 120) || null;
      }
    } catch {
      // Empty body is fine.
    }
    // Fall back to the OAuth profile name for Google sign-ins.
    if (!displayName) {
      const metaName = (user.user_metadata as Record<string, unknown> | null)?.full_name;
      if (typeof metaName === "string" && metaName.trim()) displayName = metaName.trim();
    }

    const result = await completeDenAuth({
      authUserId: user.id,
      phone: user.phone.startsWith("+") ? user.phone : `+${user.phone}`,
      displayName,
    });

    return NextResponse.json({
      den_user_id: result.denUserId,
      is_new: result.isNewDenUser,
      links: result.links.map((l) => ({
        account_id: l.accountId,
        contact_id: l.contactId,
        agency_name: l.agencyName,
      })),
    });
  } catch (err) {
    return toDenErrorResponse(err);
  }
}
