import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";

/**
 * POST /api/marketplace/items/[id]/activate
 *
 * Activates the account's copy of a marketplace item.
 * - Free items activate immediately.
 * - Paid items activate only if the account has already purchased it.
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

    if (item.price_cents > 0 && accountItem.status === "provisioned") {
      return NextResponse.json(
        { error: "This item requires purchase before activation." },
        { status: 402 },
      );
    }

    let flowId = accountItem.flow_id;
    if (!flowId) {
      // User deleted their copy; re-provision before activating.
      const { data: reprovisioned, error: rpcErr } = await admin.rpc(
        "provision_marketplace_item_for_account",
        {
          p_marketplace_item_id: id,
          p_account_id: ctx.accountId,
        },
      );
      if (rpcErr || !reprovisioned) {
        console.error("[marketplace/activate] re-provision failed:", rpcErr);
        return NextResponse.json(
          { error: "No flow copy found for this item. Contact support." },
          { status: 500 },
        );
      }
      const { data: refreshed } = await admin
        .from("account_marketplace_items")
        .select("flow_id")
        .eq("id", reprovisioned)
        .single();
      flowId = refreshed?.flow_id ?? null;
      if (!flowId) {
        return NextResponse.json(
          { error: "Re-provisioning did not return a flow copy." },
          { status: 500 },
        );
      }
    }

    const { error: updateErr } = await admin
      .from("flows")
      .update({ status: "active" })
      .eq("id", flowId)
      .eq("account_id", ctx.accountId);
    if (updateErr) {
      console.error("[marketplace/items/[id]/activate] flow update error:", updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    const { error: statusErr } = await admin
      .from("account_marketplace_items")
      .update({ status: "enabled" })
      .eq("id", accountItem.id);
    if (statusErr) {
      console.error("[marketplace/items/[id]/activate] status update error:", statusErr);
      return NextResponse.json({ error: statusErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, flow_id: flowId });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 500;
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status });
  }
}
