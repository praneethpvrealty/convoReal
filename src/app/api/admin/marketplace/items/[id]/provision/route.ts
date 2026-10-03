import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * POST /api/admin/marketplace/items/[id]/provision
 *
 * Super-admin only. Re-runs provisioning for every existing account.
 * Accounts that already have the item are skipped; accounts that don't
 * get a fresh disabled flow copy.
 */


export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

  const admin = supabaseAdmin();
  try {
    await admin.rpc("publish_marketplace_item_to_existing_accounts", {
      p_marketplace_item_id: id,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Provision failed";
    console.error("[admin/marketplace/items/[id]/provision] error:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
