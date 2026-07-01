import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";

/**
 * POST /api/admin/marketplace/items/[id]/provision
 *
 * Super-admin only. Re-runs provisioning for every existing account.
 * Accounts that already have the item are skipped; accounts that don't
 * get a fresh disabled flow copy.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function requireSuperAdmin(supabase: SupabaseServerClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false as const, status: 401, body: { error: "Unauthorized" } };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profile?.role !== "super_admin") {
    return { ok: false as const, status: 403, body: { error: "Forbidden" } };
  }
  return { ok: true as const };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const guard = await requireSuperAdmin(supabase);
  if (!guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status });
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
