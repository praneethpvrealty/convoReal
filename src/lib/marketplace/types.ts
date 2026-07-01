/**
 * Shared types for the Flow & Template Marketplace.
 *
 * Mirrors the tables added in migration 076:
 *   - marketplace_items
 *   - marketplace_item_nodes
 *   - account_marketplace_items
 */

export type MarketplaceSourceType = "template" | "flow";

export type MarketplaceItemStatus = "provisioned" | "purchased" | "enabled";

export interface MarketplaceItemRow {
  id: string;
  source_type: MarketplaceSourceType;
  source_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
  fallback_policy: Record<string, unknown>;
  published: boolean;
  price_cents: number;
  currency: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceItemNodeRow {
  id: string;
  marketplace_item_id: string;
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
  position_x: number;
  position_y: number;
}

export interface AccountMarketplaceItemRow {
  id: string;
  account_id: string;
  marketplace_item_id: string;
  status: MarketplaceItemStatus;
  flow_id: string | null;
  purchased_at: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  created_at: string;
  updated_at: string;
}
