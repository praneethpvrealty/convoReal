// ============================================================
// /api/den/settings — the Den user's notification preferences.
//
// digest_frequency doubles as WhatsApp digest consent: turning it off
// writes owner_digest_consent='declined' on every linked contact,
// turning it on writes 'granted' — so the Den setting and the
// WhatsApp STOP/START commands always agree (both channels edit the
// same contacts columns; see applyOwnerDigestCommand).
// ============================================================

import { NextResponse } from "next/server";

import { UserFacingError } from "@/lib/auth/account";
import { withDenAuth, denAdmin } from "@/lib/den/auth";

export const GET = withDenAuth(async (ctx) => {
  return NextResponse.json({
    display_name: ctx.displayName,
    notify_matches: ctx.notifyMatches,
    notify_bids: ctx.notifyBids,
    digest_frequency: ctx.digestFrequency,
  });
});

export const PUT = withDenAuth(async (ctx, req) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw new UserFacingError("Invalid request body");

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.display_name === "string") {
    update.display_name = body.display_name.trim().slice(0, 120) || null;
  }
  if (typeof body.notify_matches === "boolean") update.notify_matches = body.notify_matches;
  if (typeof body.notify_bids === "boolean") update.notify_bids = body.notify_bids;

  let digestChanged = false;
  if (body.digest_frequency !== undefined) {
    if (!["off", "daily", "weekly"].includes(body.digest_frequency as string)) {
      throw new UserFacingError("digest_frequency must be off, daily or weekly");
    }
    update.digest_frequency = body.digest_frequency;
    digestChanged = body.digest_frequency !== ctx.digestFrequency;
  }

  const db = denAdmin();
  const { error } = await db.from("den_users").update(update).eq("id", ctx.denUserId);
  if (error) {
    console.error("[den/settings PUT] update failed:", error);
    return NextResponse.json({ error: "Could not save settings" }, { status: 500 });
  }

  // Keep WhatsApp digest consent in lockstep on every linked contact.
  if (digestChanged && ctx.links.length > 0) {
    const consent = update.digest_frequency === "off" ? "declined" : "granted";
    const { error: consentErr } = await db
      .from("contacts")
      .update({ owner_digest_consent: consent, updated_at: new Date().toISOString() })
      .in("id", ctx.links.map((l) => l.contactId));
    if (consentErr) {
      console.error("[den/settings PUT] consent sync failed (non-fatal):", consentErr);
    }
  }

  return NextResponse.json({ success: true });
});
