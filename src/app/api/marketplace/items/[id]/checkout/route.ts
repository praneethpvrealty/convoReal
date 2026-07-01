import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { createRazorpayOrder } from "@/lib/marketplace/razorpay";

/**
 * POST /api/marketplace/items/[id]/checkout
 *
 * Creates a Razorpay order for a paid marketplace item. The client uses
 * the returned orderId + keyId to open Razorpay Checkout. On success
 * Razorpay posts `payment.captured` to /api/billing/razorpay-webhook,
 * which activates the provisioned flow.
 */

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const ctx = await getCurrentAccount();
    const admin = supabaseAdmin();

    const { data: item, error: itemErr } = await admin
      .from("marketplace_items")
      .select("*")
      .eq("id", id)
      .eq("published", true)
      .single();
    if (itemErr || !item) {
      return NextResponse.json({ error: "Marketplace item not found" }, { status: 404 });
    }

    if (item.price_cents <= 0) {
      return NextResponse.json({ error: "This item is free. Use /activate instead." }, { status: 400 });
    }

    const { data: accountItem, error: acctErr } = await admin
      .from("account_marketplace_items")
      .select("*")
      .eq("account_id", ctx.accountId)
      .eq("marketplace_item_id", id)
      .single();
    if (acctErr || !accountItem) {
      return NextResponse.json(
        { error: "This item has not been provisioned to your account yet." },
        { status: 404 },
      );
    }

    if (accountItem.status === "enabled" || accountItem.status === "purchased") {
      return NextResponse.json(
        { error: "You have already purchased this item." },
        { status: 409 },
      );
    }

    // Ensure a flow copy exists for the webhook to activate.
    if (!accountItem.flow_id) {
      const { data: reprovisioned, error: rpcErr } = await admin.rpc(
        "provision_marketplace_item_for_account",
        {
          p_marketplace_item_id: id,
          p_account_id: ctx.accountId,
        },
      );
      if (rpcErr || !reprovisioned) {
        console.error("[marketplace/checkout] re-provision failed:", rpcErr);
        return NextResponse.json(
          { error: "Could not prepare this item for purchase. Contact support." },
          { status: 500 },
        );
      }
    }

    const order = await createRazorpayOrder({
      amountCents: item.price_cents,
      currency: item.currency,
      receipt: `marketplace_${ctx.accountId.slice(0, 8)}_${id.slice(0, 8)}`,
      notes: {
        account_id: ctx.accountId,
        marketplace_item_id: id,
        type: "marketplace_purchase",
      },
    });

    // Record the pending order so the webhook can map it back.
    const { error: orderErr } = await admin
      .from("account_marketplace_items")
      .update({ razorpay_order_id: order.id })
      .eq("id", accountItem.id);
    if (orderErr) {
      console.error("[marketplace/items/[id]/checkout] order id save error:", orderErr);
    }

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: order.keyId,
      itemName: item.name,
    });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 500;
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[marketplace/items/[id]/checkout] error:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
