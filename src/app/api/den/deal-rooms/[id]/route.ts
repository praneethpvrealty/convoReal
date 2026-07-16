// ============================================================
// /api/den/deal-rooms/[id] — owner side of a deal room.
//
// GET  — room + accepted bid + active Token Safe state.
// POST — { action: 'meeting', meeting_at } to schedule the owner
//        meeting, or a Token Safe action:
//        { action: 'propose'|'accept'|'decline'|'cancel'|'confirm-release', ... }
// ============================================================

import { NextResponse } from "next/server";

import { UserFacingError } from "@/lib/auth/account";
import { withDenAuth, denAdmin, resolveOwnerPropertyIds, type DenContext } from "@/lib/den/auth";
import {
  applyEscrowAction,
  loadRoomEscrow,
  type DealRoomRow,
} from "@/lib/den/token-safe";

async function loadOwnedRoom(ctx: DenContext, roomId: string): Promise<DealRoomRow | null> {
  const db = denAdmin();
  const { data: room } = await db.from("deal_rooms").select("*").eq("id", roomId).maybeSingle();
  if (!room) return null;
  const ownedIds = await resolveOwnerPropertyIds(ctx);
  if (!ownedIds.includes(room.property_id as string)) return null;
  return room as DealRoomRow;
}

async function roomPayload(room: DealRoomRow) {
  const db = denAdmin();
  const [{ data: bid }, { data: agency }, escrow, { data: property }] = await Promise.all([
    db
      .from("property_bids")
      .select("id, amount, bid_type, bidder_contact_id")
      .eq("id", room.bid_id)
      .maybeSingle(),
    db.from("accounts").select("name").eq("id", room.bidder_account_id).maybeSingle(),
    loadRoomEscrow(db, room.id),
    db.from("properties").select("title").eq("id", room.property_id).maybeSingle(),
  ]);

  let buyerContact: { name: string | null; phone: string | null } | null = null;
  if (bid?.bidder_contact_id) {
    const { data: contact } = await db
      .from("contacts")
      .select("name, phone")
      .eq("id", bid.bidder_contact_id)
      .maybeSingle();
    if (contact) buyerContact = { name: contact.name ?? null, phone: contact.phone ?? null };
  }

  return {
    room,
    property_title: property?.title ?? "Your property",
    bidder_agency: agency?.name ?? "A verified agency",
    buyer_contact: buyerContact,
    escrow,
  };
}

export const GET = withDenAuth(async (ctx, _req, routeCtx) => {
  const { id } = await routeCtx.params;
  const room = await loadOwnedRoom(ctx, id);
  if (!room) throw new UserFacingError("Deal room not found", 404);
  return NextResponse.json(await roomPayload(room));
});

export const POST = withDenAuth(async (ctx, req, routeCtx) => {
  const { id } = await routeCtx.params;
  const room = await loadOwnedRoom(ctx, id);
  if (!room) throw new UserFacingError("Deal room not found", 404);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const db = denAdmin();

  if (action === "meeting") {
    const meetingAt = typeof body?.meeting_at === "string" ? body.meeting_at : null;
    if (meetingAt && Number.isNaN(Date.parse(meetingAt))) {
      throw new UserFacingError("Invalid meeting time");
    }
    await db
      .from("deal_rooms")
      .update({ meeting_at: meetingAt, updated_at: new Date().toISOString() })
      .eq("id", room.id);
    return NextResponse.json(await roomPayload({ ...room, meeting_at: meetingAt }));
  }

  const result = await applyEscrowAction(db, room, "owner", action, {
    amount: typeof body?.amount === "number" ? body.amount : undefined,
    refund_conditions:
      typeof body?.refund_conditions === "string" ? body.refund_conditions : undefined,
    provider: typeof body?.provider === "string" ? body.provider : undefined,
    provider_ref: typeof body?.provider_ref === "string" ? body.provider_ref : undefined,
  });
  if (!result.ok) throw new UserFacingError(result.error || "Could not update Token Safe", 409);
  return NextResponse.json(await roomPayload(room));
});
