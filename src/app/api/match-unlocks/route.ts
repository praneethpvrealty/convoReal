// ============================================================
// /api/match-unlocks — the paid reveal of a Deal Mode property.
//
// Staff-authenticated (the buyer/agent side): a Match Radar
// 'deal_mode' card shows a masked cross-tenant property; unlocking
// burns credits from the CALLER's account wallet and returns the full
// listing + the owner's contact card. One unlock per (account,
// property) — the UNIQUE index is the double-billing backstop, and a
// retryKey makes the burn idempotent against double-clicks.
//
// Refund policy: unlocks are final, EXCEPT the race where the owner
// turned Deal Mode off between the card appearing and the unlock —
// that's checked BEFORE burning, so the buyer simply gets a clear
// error and never pays.
// ============================================================

import { NextResponse, type NextRequest } from "next/server";

import { requireRole, toErrorResponse, UserFacingError } from "@/lib/auth/account";
import { denAdmin } from "@/lib/den/auth";
import { matchUnlockCost } from "@/lib/den/costs";
import { UNLOCKED_PROPERTY_SELECT } from "@/lib/den/masking";
import { burnCredits, refundCredits } from "@/lib/credits/burn";

interface UnlockRow {
  id: string;
  account_id: string;
  property_id: string;
  score: number | null;
  credits_burned: number;
  created_at: string;
}

async function buildUnlockedPayload(propertyId: string) {
  const db = denAdmin();
  const { data: property } = await db
    .from("properties")
    .select(UNLOCKED_PROPERTY_SELECT)
    .eq("id", propertyId)
    .maybeSingle();
  if (!property) return null;

  const propertyRow = property as unknown as Record<string, unknown>;
  let owner: { name: string | null; phone: string | null } | null = null;
  if (propertyRow.owner_contact_id) {
    const { data: contact } = await db
      .from("contacts")
      .select("name, phone")
      .eq("id", propertyRow.owner_contact_id as string)
      .maybeSingle();
    if (contact) owner = { name: contact.name ?? null, phone: contact.phone ?? null };
  }

  const { data: account } = await db
    .from("accounts")
    .select("name")
    .eq("id", propertyRow.account_id as string)
    .maybeSingle();

  return {
    property: propertyRow,
    owner,
    managing_agency: account?.name ?? null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole("agent");
    const propertyId = req.nextUrl.searchParams.get("property_id");
    if (!propertyId) throw new UserFacingError("property_id is required");

    // RLS-scoped read — only this account's unlocks are visible.
    const { data: unlock } = await ctx.supabase
      .from("den_match_unlocks")
      .select("*")
      .eq("property_id", propertyId)
      .maybeSingle();

    if (!unlock) return NextResponse.json({ unlocked: false });

    const payload = await buildUnlockedPayload(propertyId);
    return NextResponse.json({ unlocked: true, unlock, ...payload });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("agent");
    const body = (await req.json().catch(() => null)) as {
      property_id?: string;
      match_event_id?: string;
    } | null;
    const propertyId = body?.property_id;
    if (!propertyId) throw new UserFacingError("property_id is required");

    const db = denAdmin();
    const { data: property } = await db
      .from("properties")
      .select("id, account_id, deal_mode, is_published")
      .eq("id", propertyId)
      .maybeSingle();
    if (!property) throw new UserFacingError("Property not found", 404);
    if (property.account_id === ctx.accountId) {
      throw new UserFacingError("This property already belongs to your account — nothing to unlock.");
    }
    // Checked BEFORE burning: if the owner backed out, nobody pays.
    if (property.deal_mode === "off" || !property.is_published) {
      throw new UserFacingError(
        "The owner is no longer accepting interest on this property.",
        409,
      );
    }

    // Already unlocked → return it, no charge.
    const { data: existing } = await db
      .from("den_match_unlocks")
      .select("*")
      .eq("account_id", ctx.accountId)
      .eq("property_id", propertyId)
      .maybeSingle();
    if (existing) {
      const payload = await buildUnlockedPayload(propertyId);
      return NextResponse.json({ unlocked: true, unlock: existing, already: true, ...payload });
    }

    // Best score from the radar event (prices the unlock tier).
    let score: number | null = null;
    let matchEventId: string | null = null;
    if (body?.match_event_id) {
      const { data: event } = await db
        .from("match_events")
        .select("id, account_id, matches")
        .eq("id", body.match_event_id)
        .eq("account_id", ctx.accountId)
        .eq("property_id", propertyId)
        .maybeSingle();
      if (event) {
        matchEventId = event.id as string;
        const scores = (event.matches as Array<{ score?: number }> | null)?.map((m) => m.score ?? 0) ?? [];
        score = scores.length ? Math.max(...scores) : null;
      }
    }

    const cost = matchUnlockCost(score);
    const burn = await burnCredits(ctx.accountId, "match_unlock", cost, {
      retryKey: `unlock:${ctx.accountId}:${propertyId}`,
      hardBlock: true,
    });
    if (!burn.success) {
      return NextResponse.json(
        {
          error: `Not enough credits — you need ${burn.deficit} more. Top up to unlock this owner.`,
          code: "insufficient_credits",
          deficit: burn.deficit,
          cost,
        },
        { status: 402 },
      );
    }

    const { data: unlock, error: insertErr } = await db
      .from("den_match_unlocks")
      .insert({
        account_id: ctx.accountId,
        property_id: propertyId,
        unlocked_by_user_id: ctx.userId,
        match_event_id: matchEventId,
        score,
        credits_burned: cost,
        retry_key: `unlock:${ctx.accountId}:${propertyId}`,
      })
      .select("*")
      .single();

    if (insertErr || !unlock) {
      if (insertErr?.code === "23505") {
        // A concurrent request won the unique index — refund this burn
        // and hand back the winner's row.
        await refundCredits(ctx.accountId, "match_unlock", cost, {
          description: "match_unlock duplicate refund",
        }).catch((err) => console.error("[match-unlocks] duplicate refund failed:", err));
        const { data: winner } = await db
          .from("den_match_unlocks")
          .select("*")
          .eq("account_id", ctx.accountId)
          .eq("property_id", propertyId)
          .maybeSingle();
        const payload = await buildUnlockedPayload(propertyId);
        return NextResponse.json({ unlocked: true, unlock: winner as UnlockRow, already: true, ...payload });
      }
      console.error("[match-unlocks] insert failed:", insertErr);
      // Credits were burned but the unlock wasn't recorded — refund.
      await refundCredits(ctx.accountId, "match_unlock", cost, {
        description: "match_unlock failed-insert refund",
      }).catch((err) => console.error("[match-unlocks] failure refund failed:", err));
      return NextResponse.json({ error: "Could not complete the unlock" }, { status: 500 });
    }

    const payload = await buildUnlockedPayload(propertyId);
    return NextResponse.json({
      unlocked: true,
      unlock,
      credits_burned: cost,
      balance_after: burn.balanceAfter,
      ...payload,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
