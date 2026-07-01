import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  createMarketplaceItemSnapshot,
  listMarketplaceTemplateSources,
  setMarketplaceItemPublished,
} from "@/lib/marketplace/admin";

/**
 * GET /api/admin/marketplace/items
 * POST /api/admin/marketplace/items
 *
 * Super-admin only. GET returns the marketplace catalog plus available
 * template sources. POST snapshots a template or flow into a new item.
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
  return { ok: true as const, userId: user.id };
}

export async function GET() {
  const supabase = await createClient();
  const guard = await requireSuperAdmin(supabase);
  if (!guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status });
  }

  const admin = supabaseAdmin();

  const { data: items, error } = await admin
    .from("marketplace_items")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[admin/marketplace/items] GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const itemIds = (items ?? []).map((i) => i.id);
  const [{ data: nodes }, { data: stats }] = await Promise.all([
    itemIds.length > 0
      ? admin.from("marketplace_item_nodes").select("marketplace_item_id").in("marketplace_item_id", itemIds)
      : Promise.resolve({ data: [] as { marketplace_item_id: string }[] }),
    admin.from("account_marketplace_items").select("marketplace_item_id, status"),
  ]);

  const nodeCounts = new Map<string, number>();
  for (const n of nodes ?? []) {
    nodeCounts.set(n.marketplace_item_id, (nodeCounts.get(n.marketplace_item_id) ?? 0) + 1);
  }

  const countsByItem = new Map<string, { provisioned: number; purchased: number; enabled: number }>();
  for (const row of stats ?? []) {
    const cur = countsByItem.get(row.marketplace_item_id) ?? { provisioned: 0, purchased: 0, enabled: 0 };
    if (row.status === "provisioned") cur.provisioned += 1;
    if (row.status === "purchased") cur.purchased += 1;
    if (row.status === "enabled") cur.enabled += 1;
    countsByItem.set(row.marketplace_item_id, cur);
  }

  return NextResponse.json({
    items: (items ?? []).map((item) => ({
      ...item,
      node_count: nodeCounts.get(item.id) ?? 0,
      stats: countsByItem.get(item.id) ?? { provisioned: 0, purchased: 0, enabled: 0 },
    })),
    templateSources: listMarketplaceTemplateSources(),
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const guard = await requireSuperAdmin(supabase);
  if (!guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        source_type?: "template" | "flow";
        source_id?: string;
        name?: string;
        description?: string | null;
        icon?: string | null;
        price_cents?: number;
        currency?: string;
        published?: boolean;
      }
    | null;
  if (!body?.source_type || !body?.source_id) {
    return NextResponse.json({ error: "source_type and source_id are required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  try {
    const itemId = await createMarketplaceItemSnapshot(admin, {
      source_type: body.source_type,
      source_id: body.source_id,
      name: body.name ?? "",
      description: body.description,
      icon: body.icon,
      price_cents: typeof body.price_cents === "number" ? Math.max(0, body.price_cents) : 0,
      currency: body.currency ?? "INR",
    }, guard.userId);

    if (body.published) {
      await setMarketplaceItemPublished(admin, itemId, true);
    }

    const { data: item } = await admin.from("marketplace_items").select("*").eq("id", itemId).single();
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create marketplace item";
    console.error("[admin/marketplace/items] POST error:", err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
