// ============================================================
// Owners Den — Token Safe state machine (server-only).
//
// Deal room + token escrow logic shared by the owner-side
// (/api/den/deal-rooms/*) and bidder-side (/api/deal-rooms/*) routes.
// All transitions are atomic conditional updates.
//
// Escrow lifecycle:
//   proposed  → accepted (other party) | cancelled (either)
//   accepted  → funded (bidder records the payment) | cancelled
//   funded    → released (BOTH parties confirm the agreement-to-sell
//               is signed) | refunded | disputed
//
// Providers today are record-keeping ('manual_escrow', 'direct');
// licensed partners (Escrowpay/Castler) plug in via TokenSafeProvider
// below — the webhook route (/api/webhooks/token-safe) already
// verifies signatures and drives funded/released/refunded from
// partner events by provider_ref.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export type EscrowStatus =
  | "proposed"
  | "accepted"
  | "funded"
  | "released"
  | "refunded"
  | "disputed"
  | "cancelled";

export type EscrowParty = "owner" | "bidder";

export interface DealRoomRow {
  id: string;
  bid_id: string;
  property_id: string;
  owner_account_id: string;
  bidder_account_id: string;
  agreed_amount: number;
  status: "open" | "token_secured" | "closed" | "cancelled";
  meeting_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface TokenEscrowRow {
  id: string;
  deal_room_id: string;
  amount_minor: number;
  currency: string;
  refund_conditions: string | null;
  provider: string;
  provider_ref: string | null;
  status: EscrowStatus;
  proposed_by: EscrowParty;
  owner_confirmed_at: string | null;
  bidder_confirmed_at: string | null;
  funded_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

/**
 * Future partner integration point. A licensed escrow provider
 * implements this and registers under its provider key; the routes
 * call it instead of the record-keeping transitions.
 */
export interface TokenSafeProvider {
  createEscrow(args: {
    amountMinor: number;
    currency: string;
    refundConditions: string | null;
  }): Promise<{ providerRef: string; checkoutUrl: string | null }>;
  release(providerRef: string): Promise<void>;
  refund(providerRef: string): Promise<void>;
}

/** Opens the deal room for an accepted bid. Idempotent — the UNIQUE
 *  (bid_id) makes a second call return the existing room. */
export async function openDealRoom(
  db: SupabaseClient,
  bid: {
    id: string;
    property_id: string;
    owner_account_id: string;
    bidder_account_id: string;
    amount: number;
  },
): Promise<DealRoomRow | null> {
  const { data: created, error } = await db
    .from("deal_rooms")
    .insert({
      bid_id: bid.id,
      property_id: bid.property_id,
      owner_account_id: bid.owner_account_id,
      bidder_account_id: bid.bidder_account_id,
      agreed_amount: bid.amount,
    })
    .select("*")
    .maybeSingle();
  if (created) return created as DealRoomRow;
  if (error && error.code !== "23505") {
    console.error("[token-safe] deal room insert failed:", error.message);
    return null;
  }
  const { data: existing } = await db
    .from("deal_rooms")
    .select("*")
    .eq("bid_id", bid.id)
    .maybeSingle();
  return (existing as DealRoomRow) ?? null;
}

export async function loadRoomEscrow(
  db: SupabaseClient,
  dealRoomId: string,
): Promise<TokenEscrowRow | null> {
  const { data } = await db
    .from("token_escrows")
    .select("*")
    .eq("deal_room_id", dealRoomId)
    .in("status", ["proposed", "accepted", "funded", "disputed", "released", "refunded"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as TokenEscrowRow) ?? null;
}

export interface EscrowActionResult {
  ok: boolean;
  error?: string;
  escrow?: TokenEscrowRow;
}

async function transitionEscrow(
  db: SupabaseClient,
  escrowId: string,
  from: EscrowStatus[],
  to: EscrowStatus,
  extra: Record<string, unknown> = {},
): Promise<TokenEscrowRow | null> {
  const terminal = ["released", "refunded", "cancelled"].includes(to);
  const { data, error } = await db
    .from("token_escrows")
    .update({
      status: to,
      updated_at: new Date().toISOString(),
      ...(terminal ? { resolved_at: new Date().toISOString() } : {}),
      ...extra,
    })
    .eq("id", escrowId)
    .in("status", from)
    .select("*")
    .maybeSingle();
  if (error) {
    console.error("[token-safe] escrow transition failed:", error.message);
    return null;
  }
  return (data as TokenEscrowRow) ?? null;
}

/**
 * The one action entry point both routes use. `party` is who is
 * acting; role rules are enforced here so the two routes can't drift.
 */
export async function applyEscrowAction(
  db: SupabaseClient,
  room: DealRoomRow,
  party: EscrowParty,
  action: string,
  args: {
    amount?: number;
    refund_conditions?: string;
    provider?: string;
    provider_ref?: string;
  },
): Promise<EscrowActionResult> {
  const active = await loadRoomEscrow(db, room.id);
  const live = active && ["proposed", "accepted", "funded", "disputed"].includes(active.status)
    ? active
    : null;

  switch (action) {
    case "propose": {
      if (live) return { ok: false, error: "There's already an active Token Safe on this deal." };
      const amount = Number(args.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, error: "Enter a valid token amount" };
      }
      const provider = ["manual_escrow", "direct"].includes(args.provider || "")
        ? (args.provider as string)
        : "manual_escrow";
      const { data, error } = await db
        .from("token_escrows")
        .insert({
          deal_room_id: room.id,
          amount_minor: Math.round(amount * 100),
          refund_conditions:
            typeof args.refund_conditions === "string"
              ? args.refund_conditions.slice(0, 2000)
              : null,
          provider,
          proposed_by: party,
        })
        .select("*")
        .single();
      if (error || !data) {
        return {
          ok: false,
          error:
            error?.code === "23505"
              ? "There's already an active Token Safe on this deal."
              : "Could not propose Token Safe",
        };
      }
      return { ok: true, escrow: data as TokenEscrowRow };
    }

    case "accept": {
      if (!live) return { ok: false, error: "Nothing to accept" };
      if (live.proposed_by === party) {
        return { ok: false, error: "Waiting for the other party to accept your proposal." };
      }
      const updated = await transitionEscrow(db, live.id, ["proposed"], "accepted");
      return updated ? { ok: true, escrow: updated } : { ok: false, error: "Already resolved" };
    }

    case "decline":
    case "cancel": {
      if (!live) return { ok: false, error: "Nothing to cancel" };
      // Funded money can't be cancelled in-app — release or refund only.
      const updated = await transitionEscrow(db, live.id, ["proposed", "accepted"], "cancelled");
      return updated
        ? { ok: true, escrow: updated }
        : { ok: false, error: "A funded token can only be released or refunded." };
    }

    case "mark-funded": {
      if (!live) return { ok: false, error: "No active Token Safe" };
      if (party !== "bidder") return { ok: false, error: "Only the buyer side records the payment." };
      const ref = typeof args.provider_ref === "string" ? args.provider_ref.trim().slice(0, 200) : "";
      if (!ref) return { ok: false, error: "Enter the payment reference (escrow ID / UTR / cheque no.)" };
      const updated = await transitionEscrow(db, live.id, ["accepted"], "funded", {
        provider_ref: ref,
        funded_at: new Date().toISOString(),
      });
      return updated
        ? { ok: true, escrow: updated }
        : { ok: false, error: "Token Safe must be accepted by both parties first." };
    }

    case "confirm-release": {
      if (!live) return { ok: false, error: "No active Token Safe" };
      if (live.status !== "funded") {
        return { ok: false, error: "The token must be funded before release." };
      }
      const field = party === "owner" ? "owner_confirmed_at" : "bidder_confirmed_at";
      if (live[field]) return { ok: true, escrow: live }; // idempotent
      const otherConfirmed = party === "owner" ? live.bidder_confirmed_at : live.owner_confirmed_at;

      if (otherConfirmed) {
        // Second confirmation → release, and the room is token_secured.
        const updated = await transitionEscrow(db, live.id, ["funded"], "released", {
          [field]: new Date().toISOString(),
        });
        if (!updated) return { ok: false, error: "Already resolved" };
        await db
          .from("deal_rooms")
          .update({ status: "token_secured", updated_at: new Date().toISOString() })
          .eq("id", room.id)
          .eq("status", "open");
        return { ok: true, escrow: updated };
      }

      const { data, error } = await db
        .from("token_escrows")
        .update({ [field]: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", live.id)
        .eq("status", "funded")
        .select("*")
        .maybeSingle();
      if (error || !data) return { ok: false, error: "Could not record your confirmation" };
      return { ok: true, escrow: data as TokenEscrowRow };
    }

    default:
      return { ok: false, error: `Unknown action: ${action}` };
  }
}
