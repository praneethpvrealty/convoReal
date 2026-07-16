// POST /api/bids/[id]/withdraw — bidder pulls a live offer.

import { NextResponse, type NextRequest } from "next/server";

import { requireRole, toErrorResponse, UserFacingError } from "@/lib/auth/account";
import { denAdmin } from "@/lib/den/auth";
import { appendBidEvent, notifyOwnerOfBid, transitionBid } from "@/lib/den/bids";

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
      .select("id, bidder_account_id, status")
      .eq("id", id)
      .maybeSingle();
    if (!bid || bid.bidder_account_id !== ctx.accountId) {
      throw new UserFacingError("Offer not found", 404);
    }

    const updated = await transitionBid(db, id, ["pending", "countered"], "withdrawn");
    if (!updated) {
      throw new UserFacingError("This offer can no longer be withdrawn.", 409);
    }
    await appendBidEvent(db, id, "bidder", "withdrawn");

    const { data: property } = await db
      .from("properties")
      .select("title, account_id, owner_contact_id")
      .eq("id", updated.property_id)
      .maybeSingle();
    if (property?.owner_contact_id) {
      notifyOwnerOfBid(db, {
        ownerAccountId: property.account_id,
        ownerContactId: property.owner_contact_id,
        propertyTitle: property.title,
        amount: updated.amount,
        kind: "withdrawn",
        bidderAgency: ctx.account.name,
      }).catch((err) => console.error("[bids withdraw] owner notify failed:", err));
    }

    return NextResponse.json({ bid: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
