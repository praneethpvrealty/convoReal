import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  refreshMarketplaceItemSnapshot,
  setMarketplaceItemPublished,
} from "@/lib/marketplace/admin";

/**
 * PATCH /api/admin/marketplace/items/[id]
 * DELETE /api/admin/marketplace/items/[id]
 *
 * Super-admin only. PATCH can update metadata, price, or published state.
 * DELETE removes the marketplace item and its snapshot; copied flows in
 * accounts are left untouched.
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const guard = await requireSuperAdmin(supabase);
  if (!guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        name?: string;
        description?: string | null;
        icon?: string | null;
        price_cents?: number;
        currency?: string;
        published?: boolean;
        refresh_snapshot?: boolean;
      }
    | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  try {
    if (body.refresh_snapshot) {
      await refreshMarketplaceItemSnapshot(admin, id);
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.description !== undefined) updates.description = body.description;
    if (body.icon !== undefined) updates.icon = body.icon;
    if (body.price_cents !== undefined) updates.price_cents = Math.max(0, body.price_cents);
    if (body.currency !== undefined) updates.currency = body.currency;

    const hasMetaUpdates = Object.keys(updates).length > 0;

    if (body.published !== undefined) {
      await setMarketplaceItemPublished(admin, id, body.published);
    } else if (hasMetaUpdates) {
      const { error } = await admin.from("marketplace_items").update(updates).eq("id", id);
      if (error) throw error;
    }

    const { data: item, error } = await admin
      .from("marketplace_items")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !item) {
      return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 404 });
    }
    return NextResponse.json({ item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Update failed";
    console.error("[admin/marketplace/items/[id]] PATCH error:", err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(
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
  const { error } = await admin.from("marketplace_items").delete().eq("id", id);
  if (error) {
    console.error("[admin/marketplace/items/[id]] DELETE error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
