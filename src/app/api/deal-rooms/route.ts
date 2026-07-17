// GET /api/deal-rooms?bid_id= — bidder side lookup of the deal room
// (opened automatically when a bid is accepted).

import { NextResponse, type NextRequest } from "next/server";

import { requireRole, toErrorResponse, UserFacingError } from "@/lib/auth/account";
import { denAdmin } from "@/lib/den/auth";
import { loadRoomEscrow } from "@/lib/den/token-safe";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole("agent");
    const bidId = req.nextUrl.searchParams.get("bid_id");
    if (!bidId) throw new UserFacingError("bid_id is required");

    // RLS-scoped: only rooms where this account is a party.
    const { data: room } = await ctx.supabase
      .from("deal_rooms")
      .select("*")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (!room || room.bidder_account_id !== ctx.accountId) {
      return NextResponse.json({ room: null });
    }

    const escrow = await loadRoomEscrow(denAdmin(), room.id as string);
    return NextResponse.json({ room, escrow });
  } catch (err) {
    return toErrorResponse(err);
  }
}
