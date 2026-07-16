// POST /api/bids/[id]/accept-counter — bidder takes the owner's
// counter-offer: countered → accepted at counter_amount.

import { NextResponse, type NextRequest } from "next/server";

import { requireRole, toErrorResponse, UserFacingError } from "@/lib/auth/account";
import { denAdmin } from "@/lib/den/auth";
import { appendBidEvent, transitionBid } from "@/lib/den/bids";

export async function POST(
  _req: NextRequest,
  routeCtx: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await routeCtx.params;

    const db = denAdmin();
    const { data: bid } = await db
      .from("property_bids")
      .select("id, bidder_account_id, status, counter_amount")
      .eq("id", id)
      .maybeSingle();
    if (!bid || bid.bidder_account_id !== ctx.accountId) {
      throw new UserFacingError("Offer not found", 404);
    }
    if (bid.status !== "countered" || !bid.counter_amount) {
      throw new UserFacingError("There's no live counter-offer to accept.", 409);
    }

    // The agreed figure becomes the bid amount.
    const updated = await transitionBid(db, id, ["countered"], "accepted", {
      amount: bid.counter_amount,
    });
    if (!updated) {
      throw new UserFacingError("This counter-offer can no longer be accepted.", 409);
    }
    await appendBidEvent(db, id, "bidder", "counter_accepted", {
      amount: bid.counter_amount,
    });

    return NextResponse.json({ bid: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
