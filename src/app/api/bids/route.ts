// ============================================================
// /api/bids — bidder (buyer/agent staff) side of Owners Den offers.
//
// POST — place a FREE bid on an unlocked Deal Mode property. Requires
//        this account's den_match_unlocks row: the unlock fee is the
//        skin-in-the-game, bidding itself costs nothing. One live bid
//        per (account, property) at a time.
// GET  — this account's bids (RLS-scoped), ?property_id= to filter.
// ============================================================

import { NextResponse, type NextRequest } from "next/server";

import { requireRole, toErrorResponse, UserFacingError } from "@/lib/auth/account";
import { denAdmin } from "@/lib/den/auth";
import { appendBidEvent, bidExpiryIso, notifyOwnerOfBid } from "@/lib/den/bids";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole("agent");
    let query = ctx.supabase
      .from("property_bids")
      .select("*")
      .eq("bidder_account_id", ctx.accountId)
      .order("created_at", { ascending: false })
      .limit(100);
    const propertyId = req.nextUrl.searchParams.get("property_id");
    if (propertyId) query = query.eq("property_id", propertyId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ bids: data || [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("agent");

    const rate = checkRateLimit(`bids:${ctx.accountId}`, { limit: 20, windowMs: 60_000 });
    if (!rate.success) return rateLimitResponse(rate);

    const body = (await req.json().catch(() => null)) as {
      property_id?: string;
      amount?: number;
      message?: string;
      contact_id?: string;
    } | null;
    const propertyId = body?.property_id;
    const amount = Number(body?.amount);
    if (!propertyId) throw new UserFacingError("property_id is required");
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new UserFacingError("Enter a valid offer amount");
    }

    const db = denAdmin();

    // Bids only after a paid unlock — that row is the entry ticket.
    const { data: unlock } = await db
      .from("den_match_unlocks")
      .select("id")
      .eq("account_id", ctx.accountId)
      .eq("property_id", propertyId)
      .maybeSingle();
    if (!unlock) {
      throw new UserFacingError("Unlock this property before placing an offer.", 403);
    }

    const { data: property } = await db
      .from("properties")
      .select("id, account_id, title, listing_type, deal_mode, is_published, min_bid, owner_contact_id")
      .eq("id", propertyId)
      .maybeSingle();
    if (!property) throw new UserFacingError("Property not found", 404);
    if (property.deal_mode === "off" || !property.is_published) {
      throw new UserFacingError("The owner is no longer accepting offers on this property.", 409);
    }
    if (property.min_bid && amount < Number(property.min_bid)) {
      throw new UserFacingError(
        `The owner only considers offers of ₹${Number(property.min_bid).toLocaleString("en-IN")} or more.`,
      );
    }

    // One live bid per account+property — counter it or withdraw first.
    const { data: live } = await db
      .from("property_bids")
      .select("id, status")
      .eq("bidder_account_id", ctx.accountId)
      .eq("property_id", propertyId)
      .in("status", ["pending", "countered"])
      .maybeSingle();
    if (live) {
      throw new UserFacingError(
        "You already have a live offer on this property — withdraw it before placing a new one.",
        409,
      );
    }

    // The buyer this bid is for must be one of the caller's contacts.
    let bidderContactId: string | null = null;
    if (body?.contact_id) {
      const { data: contact } = await ctx.supabase
        .from("contacts")
        .select("id")
        .eq("id", body.contact_id)
        .maybeSingle();
      if (contact) bidderContactId = contact.id as string;
    }

    const { data: bid, error: insertErr } = await db
      .from("property_bids")
      .insert({
        property_id: propertyId,
        owner_account_id: property.account_id,
        bidder_account_id: ctx.accountId,
        bidder_user_id: ctx.userId,
        bidder_contact_id: bidderContactId,
        unlock_id: unlock.id,
        amount,
        bid_type: property.listing_type === "Rent" ? "rent" : "sale",
        message: typeof body?.message === "string" ? body.message.slice(0, 1000) : null,
        expires_at: bidExpiryIso(),
      })
      .select("*")
      .single();
    if (insertErr || !bid) {
      console.error("[bids POST] insert failed:", insertErr);
      return NextResponse.json({ error: "Could not place your offer" }, { status: 500 });
    }

    await appendBidEvent(db, bid.id, "bidder", "placed", { amount });

    // Ping the owner (best-effort, fire-and-forget).
    if (property.owner_contact_id) {
      notifyOwnerOfBid(db, {
        ownerAccountId: property.account_id,
        ownerContactId: property.owner_contact_id,
        propertyTitle: property.title,
        amount,
        kind: "new",
        bidderAgency: ctx.account.name,
      }).catch((err) => console.error("[bids POST] owner notify failed:", err));
    }

    return NextResponse.json({ bid }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
