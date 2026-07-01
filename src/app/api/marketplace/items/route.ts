import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/account";

/**
 * GET /api/marketplace/items
 *
 * Returns every published marketplace item plus this account's status
 * for each item (provisioned/purchased/enabled) and the copied flow id.
 */

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data: items, error: itemsErr } = await ctx.supabase
      .from("marketplace_items")
      .select("*")
      .eq("published", true)
      .order("created_at", { ascending: false });
    if (itemsErr) {
      console.error("[marketplace/items] load items error:", itemsErr);
      return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }

    const { data: accountItems, error: acctErr } = await ctx.supabase
      .from("account_marketplace_items")
      .select("marketplace_item_id, status, flow_id, purchased_at")
      .eq("account_id", ctx.accountId);
    if (acctErr) {
      console.error("[marketplace/items] load account items error:", acctErr);
      return NextResponse.json({ error: acctErr.message }, { status: 500 });
    }

    const statusByItem = new Map(
      (accountItems ?? []).map((a) => [a.marketplace_item_id, a]),
    );

    return NextResponse.json({
      items: (items ?? []).map((item) => {
        const accountState = statusByItem.get(item.id);
        return {
          ...item,
          account_status: accountState?.status ?? null,
          account_flow_id: accountState?.flow_id ?? null,
          purchased_at: accountState?.purchased_at ?? null,
        };
      }),
    });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 500;
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status });
  }
}
