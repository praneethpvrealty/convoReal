/**
 * Server-side helpers for marketplace administration.
 *
 * All functions use the service-role client because they operate across
 * accounts and bypass RLS. Call only from routes that have already
 * verified the caller is a super_admin.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getFlowTemplate, listFlowTemplates } from "@/lib/flows/templates";

export interface MarketplaceItemCreateInput {
  source_type: "template" | "flow";
  source_id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  price_cents: number;
  currency?: string;
  published?: boolean;
}

/**
 * Snapshot a source (template slug or existing flow id) into marketplace
 * item + marketplace_item_nodes rows. Returns the new marketplace item id.
 */
export async function createMarketplaceItemSnapshot(
  admin: SupabaseClient,
  input: MarketplaceItemCreateInput,
  createdByUserId: string,
): Promise<string> {
  const { nodes, ...itemData } = await resolveSource(admin, input);

  const { data: item, error: itemErr } = await admin
    .from("marketplace_items")
    .insert({
      ...itemData,
      created_by: createdByUserId,
      published: false, // publish is a separate step so we can snapshot first
    })
    .select("id")
    .single();

  if (itemErr || !item) {
    throw new Error(`Failed to create marketplace item: ${itemErr?.message ?? "unknown"}`);
  }

  if (nodes.length > 0) {
    const { error: nodesErr } = await admin.from("marketplace_item_nodes").insert(
      nodes.map((n) => ({
        marketplace_item_id: item.id,
        node_key: n.node_key,
        node_type: n.node_type,
        config: n.config,
        position_x: n.position_x ?? 0,
        position_y: n.position_y ?? 0,
      })),
    );
    if (nodesErr) {
      // Roll back so we don't leave a headless marketplace item.
      await admin.from("marketplace_items").delete().eq("id", item.id);
      throw new Error(`Failed to snapshot nodes: ${nodesErr.message}`);
    }
  }

  return item.id;
}

interface ResolvedSource {
  source_type: "template" | "flow";
  source_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
  fallback_policy: Record<string, unknown>;
  nodes: Array<{
    node_key: string;
    node_type: string;
    config: Record<string, unknown>;
    position_x: number;
    position_y: number;
  }>;
}

async function resolveSource(
  admin: SupabaseClient,
  input: MarketplaceItemCreateInput,
): Promise<ResolvedSource> {
  if (input.source_type === "template") {
    const template = getFlowTemplate(input.source_id);
    if (!template) {
      throw new Error(`Unknown template slug: ${input.source_id}`);
    }
    return {
      source_type: "template",
      source_id: input.source_id,
      name: input.name?.trim() || template.name,
      description: input.description ?? template.description,
      icon: input.icon ?? template.icon,
      trigger_type: template.trigger_type,
      trigger_config: template.trigger_config as Record<string, unknown>,
      entry_node_id: template.entry_node_id,
      fallback_policy: {
        on_unknown_reply: "reprompt",
        max_reprompts: 2,
        on_timeout_hours: 24,
        on_exhaust: "handoff",
      },
      nodes: template.nodes.map((n) => ({
        node_key: n.node_key,
        node_type: n.node_type,
        config: n.config as Record<string, unknown>,
        position_x: 0,
        position_y: 0,
      })),
    };
  }

  // Flow source
  const { data: flow, error: flowErr } = await admin
    .from("flows")
    .select("*")
    .eq("id", input.source_id)
    .single();
  if (flowErr || !flow) {
    throw new Error(`Source flow not found: ${flowErr?.message ?? input.source_id}`);
  }

  const { data: flowNodes, error: nodesErr } = await admin
    .from("flow_nodes")
    .select("*")
    .eq("flow_id", input.source_id);
  if (nodesErr) {
    throw new Error(`Failed to load source flow nodes: ${nodesErr.message}`);
  }

  return {
    source_type: "flow",
    source_id: input.source_id,
    name: input.name?.trim() || flow.name,
    description: input.description ?? (flow.description as string | null),
    icon: input.icon ?? null,
    trigger_type: flow.trigger_type as "keyword" | "first_inbound_message" | "manual",
    trigger_config: flow.trigger_config as Record<string, unknown>,
    entry_node_id: flow.entry_node_id as string | null,
    fallback_policy: flow.fallback_policy as Record<string, unknown>,
    nodes: (flowNodes ?? []).map((n) => ({
      node_key: n.node_key,
      node_type: n.node_type,
      config: n.config as Record<string, unknown>,
      position_x: n.position_x ?? 0,
      position_y: n.position_y ?? 0,
    })),
  };
}

/**
 * Publish (or unpublish) a marketplace item. When publishing, provision a
 * disabled copy into every existing account. Unpublishing stops new accounts
 * from receiving the item but leaves existing copies untouched.
 */
export async function setMarketplaceItemPublished(
  admin: SupabaseClient,
  marketplaceItemId: string,
  published: boolean,
): Promise<void> {
  const { error } = await admin
    .from("marketplace_items")
    .update({ published })
    .eq("id", marketplaceItemId);
  if (error) {
    throw new Error(`Failed to update published flag: ${error.message}`);
  }

  if (published) {
    await admin.rpc("publish_marketplace_item_to_existing_accounts", {
      p_marketplace_item_id: marketplaceItemId,
    });
  }
}

/**
 * Refresh the snapshot of an existing marketplace item from its source.
 * Existing copies in accounts are NOT updated; this only affects new
 * provisions (or re-provisions after deletion).
 */
export async function refreshMarketplaceItemSnapshot(
  admin: SupabaseClient,
  marketplaceItemId: string,
): Promise<void> {
  const { data: item, error } = await admin
    .from("marketplace_items")
    .select("*")
    .eq("id", marketplaceItemId)
    .single();
  if (error || !item) {
    throw new Error(`Marketplace item not found: ${error?.message ?? marketplaceItemId}`);
  }

  const input: MarketplaceItemCreateInput = {
    source_type: item.source_type as "template" | "flow",
    source_id: item.source_id,
    name: item.name,
    description: item.description,
    icon: item.icon,
    price_cents: item.price_cents,
    currency: item.currency,
  };
  const { nodes, ...itemData } = await resolveSource(admin, input);

  const { error: updErr } = await admin
    .from("marketplace_items")
    .update(itemData)
    .eq("id", marketplaceItemId);
  if (updErr) {
    throw new Error(`Failed to refresh item: ${updErr.message}`);
  }

  await admin.from("marketplace_item_nodes").delete().eq("marketplace_item_id", marketplaceItemId);
  if (nodes.length > 0) {
    const { error: nodesErr } = await admin.from("marketplace_item_nodes").insert(
      nodes.map((n) => ({
        marketplace_item_id: marketplaceItemId,
        node_key: n.node_key,
        node_type: n.node_type,
        config: n.config,
        position_x: n.position_x,
        position_y: n.position_y,
      })),
    );
    if (nodesErr) {
      throw new Error(`Failed to refresh nodes: ${nodesErr.message}`);
    }
  }
}

/**
 * List available template sources for the admin publish picker.
 */
export function listMarketplaceTemplateSources(): Array<{
  source_type: "template";
  source_id: string;
  name: string;
  description: string;
  node_count: number;
}> {
  return listFlowTemplates().map((t) => ({
    source_type: "template",
    source_id: t.slug,
    name: t.name,
    description: t.description,
    node_count: t.nodes.length,
  }));
}
