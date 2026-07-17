// ============================================================
// Owners Den — bid lifecycle helpers (server-only).
//
// All transitions run as conditional UPDATEs (WHERE status IN …), the
// same atomic-claim pattern as listing-verification: two racing
// requests can't both accept, and a withdraw can't land on an
// already-accepted bid. Every successful transition appends a
// property_bid_events audit row.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEN_BID_EXPIRY_DAYS } from "./costs";
import { sendDenNotification } from "./notify";

export const DEN_BID_RECEIVED_TEMPLATE_NAME = "den_bid_received";
export const DEN_BID_UPDATE_TEMPLATE_NAME = "den_bid_update";

export type BidStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "countered"
  | "withdrawn"
  | "expired";

export interface BidRow {
  id: string;
  property_id: string;
  owner_account_id: string;
  bidder_account_id: string;
  bidder_user_id: string | null;
  bidder_contact_id: string | null;
  unlock_id: string;
  amount: number;
  bid_type: "sale" | "rent";
  message: string | null;
  status: BidStatus;
  counter_amount: number | null;
  counter_message: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export function bidExpiryIso(now: Date = new Date()): string {
  return new Date(now.getTime() + DEN_BID_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export async function appendBidEvent(
  db: SupabaseClient,
  bidId: string,
  actor: "owner" | "bidder" | "system",
  event: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from("property_bid_events").insert({
    bid_id: bidId,
    actor,
    event,
    payload: payload ?? null,
  });
  if (error) console.error("[den-bids] audit insert failed (non-fatal):", error.message);
}

/**
 * Atomic status transition. Returns the updated row, or null when the
 * bid wasn't in an allowed source state (lost a race / stale client).
 */
export async function transitionBid(
  db: SupabaseClient,
  bidId: string,
  from: BidStatus[],
  to: BidStatus,
  extra: Record<string, unknown> = {},
): Promise<BidRow | null> {
  const terminal = ["accepted", "rejected", "withdrawn", "expired"].includes(to);
  const { data, error } = await db
    .from("property_bids")
    .update({
      status: to,
      updated_at: new Date().toISOString(),
      ...(terminal ? { resolved_at: new Date().toISOString() } : {}),
      ...extra,
    })
    .eq("id", bidId)
    .in("status", from)
    .select("*")
    .maybeSingle();
  if (error) {
    console.error("[den-bids] transition failed:", error.message);
    return null;
  }
  return (data as BidRow) ?? null;
}

const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;

/** WhatsApp ping to the OWNER contact (via the managing agency's
 *  sender) when a bid lands or changes. Best-effort. */
export async function notifyOwnerOfBid(
  db: SupabaseClient,
  args: {
    ownerAccountId: string;
    ownerContactId: string;
    propertyTitle: string;
    amount: number;
    kind: "new" | "withdrawn";
    bidderAgency: string | null;
  },
): Promise<boolean> {
  const { data: ownerContact } = await db
    .from("contacts")
    .select("id, name")
    .eq("id", args.ownerContactId)
    .maybeSingle();
  const firstName = (ownerContact?.name as string | undefined)?.trim().split(/\s+/)[0] || "there";
  const via = args.bidderAgency ? ` via ${args.bidderAgency}` : "";
  const text =
    args.kind === "new"
      ? `💰 *New offer on your property!*\n\nHi ${firstName}, you've received an offer of *${inr(args.amount)}* on *${args.propertyTitle}*${via}.\n\nOpen your Owners Den to accept, reject or counter it.`
      : `An offer of ${inr(args.amount)} on *${args.propertyTitle}* was withdrawn by the buyer.`;
  return sendDenNotification(db, {
    accountId: args.ownerAccountId,
    contactId: args.ownerContactId,
    text,
    templateName: DEN_BID_RECEIVED_TEMPLATE_NAME,
    templateParams: [firstName, args.propertyTitle, inr(args.amount)],
  });
}

/** WhatsApp ping to the BIDDER's buyer contact (when the bid was
 *  placed for one) on owner responses. Best-effort. */
export async function notifyBidderOfOutcome(
  db: SupabaseClient,
  args: {
    bidderAccountId: string;
    bidderContactId: string | null;
    propertyTitle: string;
    outcome: "accepted" | "rejected" | "countered";
    counterAmount?: number | null;
  },
): Promise<boolean> {
  if (!args.bidderContactId) return false;
  const text =
    args.outcome === "accepted"
      ? `🎉 *Offer accepted!* The owner of *${args.propertyTitle}* accepted your offer. Your agent will share the owner's contact details to take it forward.`
      : args.outcome === "countered"
        ? `↩️ The owner of *${args.propertyTitle}* made a counter-offer${args.counterAmount ? ` of *${inr(args.counterAmount)}*` : ""}. Ask your agent for details.`
        : `The owner of *${args.propertyTitle}* declined your offer. Your agent can help you find similar options.`;
  return sendDenNotification(db, {
    accountId: args.bidderAccountId,
    contactId: args.bidderContactId,
    text,
    templateName: DEN_BID_UPDATE_TEMPLATE_NAME,
    templateParams: [args.propertyTitle, args.outcome],
  });
}
