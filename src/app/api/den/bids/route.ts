// ============================================================
// GET /api/den/bids — the owner's offer inbox.
//
// Every bid on the caller's properties, across all linked agencies.
// The BIDDER stays masked as a professional card (agency name only)
// until a bid is accepted — personal contact details are revealed
// mutually and only on accept.
// ============================================================

import { NextResponse } from "next/server";

import { withDenAuth, denAdmin, resolveOwnerPropertyIds } from "@/lib/den/auth";
import { storagePublicUrl } from "@/lib/storage/url";

export const GET = withDenAuth(async (ctx) => {
  const propertyIds = await resolveOwnerPropertyIds(ctx);
  if (propertyIds.length === 0) return NextResponse.json({ bids: [] });

  const db = denAdmin();
  const { data: bids, error } = await db
    .from("property_bids")
    .select("*")
    .in("property_id", propertyIds)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[den/bids GET] query error:", error);
    return NextResponse.json({ error: "Could not load your offers" }, { status: 500 });
  }

  const rows = bids || [];
  const bidderAccountIds = [...new Set(rows.map((b) => b.bidder_account_id as string))];
  const bidPropertyIds = [...new Set(rows.map((b) => b.property_id as string))];

  const [{ data: agencies }, { data: properties }] = await Promise.all([
    bidderAccountIds.length
      ? db.from("accounts").select("id, name").in("id", bidderAccountIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    bidPropertyIds.length
      ? db.from("properties").select("id, title, listing_type, images").in("id", bidPropertyIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const agencyById = new Map((agencies || []).map((a) => [a.id as string, a.name as string]));
  const propertyById = new Map((properties || []).map((p) => [p.id as string, p]));

  // Accepted bids reveal the bidding side's contact person.
  // Accepted bids have a deal room (Token Safe lives there).
  const acceptedBidIds = rows.filter((b) => b.status === "accepted").map((b) => b.id as string);
  const { data: rooms } = acceptedBidIds.length
    ? await db.from("deal_rooms").select("id, bid_id").in("bid_id", acceptedBidIds)
    : { data: [] as { id: string; bid_id: string }[] };
  const roomByBid = new Map((rooms || []).map((r) => [r.bid_id as string, r.id as string]));

  const acceptedContactIds = rows
    .filter((b) => b.status === "accepted" && b.bidder_contact_id)
    .map((b) => b.bidder_contact_id as string);
  const { data: revealedContacts } = acceptedContactIds.length
    ? await db.from("contacts").select("id, name, phone").in("id", acceptedContactIds)
    : { data: [] as { id: string; name: string | null; phone: string | null }[] };
  const contactById = new Map((revealedContacts || []).map((c) => [c.id as string, c]));

  const payload = rows.map((bid) => {
    const property = propertyById.get(bid.property_id as string);
    const revealed =
      bid.status === "accepted" && bid.bidder_contact_id
        ? contactById.get(bid.bidder_contact_id as string)
        : null;
    return {
      id: bid.id,
      property_id: bid.property_id,
      property_title: (property?.title as string) ?? "Your property",
      property_image: Array.isArray(property?.images)
        ? storagePublicUrl((property?.images as string[])[0] ?? null) || null
        : null,
      amount: bid.amount,
      bid_type: bid.bid_type,
      message: bid.message,
      status: bid.status,
      counter_amount: bid.counter_amount,
      counter_message: bid.counter_message,
      expires_at: bid.expires_at,
      created_at: bid.created_at,
      resolved_at: bid.resolved_at,
      bidder_agency: agencyById.get(bid.bidder_account_id as string) ?? "A verified agency",
      // Masked until accepted.
      bidder_contact: revealed
        ? { name: revealed.name ?? null, phone: revealed.phone ?? null }
        : null,
      deal_room_id: roomByBid.get(bid.id as string) ?? null,
    };
  });

  return NextResponse.json({ bids: payload });
});
