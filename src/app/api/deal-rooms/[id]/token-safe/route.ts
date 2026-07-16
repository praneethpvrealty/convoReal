// POST /api/deal-rooms/[id]/token-safe — bidder-side Token Safe
// actions: propose / accept / decline / cancel / mark-funded /
// confirm-release. Role rules live in applyEscrowAction.

import { NextResponse, type NextRequest } from "next/server";

import { requireRole, toErrorResponse, UserFacingError } from "@/lib/auth/account";
import { denAdmin } from "@/lib/den/auth";
import { applyEscrowAction, loadRoomEscrow, type DealRoomRow } from "@/lib/den/token-safe";

export async function POST(
  req: NextRequest,
  routeCtx: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await routeCtx.params;

    const db = denAdmin();
    const { data: room } = await db.from("deal_rooms").select("*").eq("id", id).maybeSingle();
    if (!room || room.bidder_account_id !== ctx.accountId) {
      throw new UserFacingError("Deal room not found", 404);
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const action = typeof body?.action === "string" ? body.action : "";

    const result = await applyEscrowAction(db, room as DealRoomRow, "bidder", action, {
      amount: typeof body?.amount === "number" ? body.amount : undefined,
      refund_conditions:
        typeof body?.refund_conditions === "string" ? body.refund_conditions : undefined,
      provider: typeof body?.provider === "string" ? body.provider : undefined,
      provider_ref: typeof body?.provider_ref === "string" ? body.provider_ref : undefined,
    });
    if (!result.ok) throw new UserFacingError(result.error || "Could not update Token Safe", 409);

    const escrow = await loadRoomEscrow(db, id);
    return NextResponse.json({ room, escrow });
  } catch (err) {
    return toErrorResponse(err);
  }
}
