// ============================================================
// POST /api/den/bids/[id] — owner responds to an offer.
//
// Body: { action: 'accept' } | { action: 'reject' }
//     | { action: 'counter', amount, message? }
//
// Accept = mutual reveal: the response carries the bidder's contact
// card, and the bidder's buyer gets a WhatsApp ping. All transitions
// are atomic conditional updates (see src/lib/den/bids.ts).
// ============================================================

import { NextResponse } from "next/server";

import { UserFacingError } from "@/lib/auth/account";
import { withDenAuth, denAdmin } from "@/lib/den/auth";
import { appendBidEvent, notifyBidderOfOutcome, transitionBid, type BidRow } from "@/lib/den/bids";
import { loadOwnedProperty } from "@/lib/den/properties";

export const POST = withDenAuth(async (ctx, req, routeCtx) => {
  const { id } = await routeCtx.params;
  const body = (await req.json().catch(() => null)) as {
    action?: string;
    amount?: number;
    message?: string;
  } | null;
  const action = body?.action;
  if (!action || !["accept", "reject", "counter"].includes(action)) {
    throw new UserFacingError("action must be accept, reject or counter");
  }

  const db = denAdmin();
  const { data: bid } = await db
    .from("property_bids")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!bid) throw new UserFacingError("Offer not found", 404);

  // Ownership: the bid's property must belong to this Den user.
  const property = await loadOwnedProperty(ctx, bid.property_id as string);
  if (!property) throw new UserFacingError("Offer not found", 404);

  let updated: BidRow | null = null;
  if (action === "accept") {
    updated = await transitionBid(db, id, ["pending", "countered"], "accepted");
    if (updated) await appendBidEvent(db, id, "owner", "accepted", { amount: updated.amount });
  } else if (action === "reject") {
    updated = await transitionBid(db, id, ["pending", "countered"], "rejected");
    if (updated) await appendBidEvent(db, id, "owner", "rejected");
  } else {
    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new UserFacingError("Enter a valid counter-offer amount");
    }
    updated = await transitionBid(db, id, ["pending"], "countered", {
      counter_amount: amount,
      counter_message: typeof body?.message === "string" ? body.message.slice(0, 1000) : null,
    });
    if (updated) await appendBidEvent(db, id, "owner", "countered", { amount });
  }

  if (!updated) {
    throw new UserFacingError("This offer has already been resolved.", 409);
  }

  // Best-effort ping to the bidder's buyer contact.
  notifyBidderOfOutcome(db, {
    bidderAccountId: updated.bidder_account_id,
    bidderContactId: updated.bidder_contact_id,
    propertyTitle: (property.title as string) || "the property",
    outcome: action === "accept" ? "accepted" : action === "reject" ? "rejected" : "countered",
    counterAmount: updated.counter_amount,
  }).catch((err) => console.error("[den/bids action] bidder notify failed:", err));

  // Mutual reveal on accept: the bidding agency's card (and buyer
  // contact when one was attached).
  let revealed: { agency: string | null; contact: { name: string | null; phone: string | null } | null } | null =
    null;
  if (action === "accept") {
    const [{ data: agency }, { data: contact }] = await Promise.all([
      db.from("accounts").select("name").eq("id", updated.bidder_account_id).maybeSingle(),
      updated.bidder_contact_id
        ? db.from("contacts").select("name, phone").eq("id", updated.bidder_contact_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    revealed = {
      agency: agency?.name ?? null,
      contact: contact ? { name: contact.name ?? null, phone: contact.phone ?? null } : null,
    };
  }

  return NextResponse.json({ bid: updated, revealed });
});
