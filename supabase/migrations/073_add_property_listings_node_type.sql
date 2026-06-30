-- Migration: add send_property_listings node type to flow_nodes CHECK
-- and update Real Estate Showcase template nodes to use it

-- 1. Expand the node_type CHECK constraint to include the new type
ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'send_property_listings',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'http_fetch',
    'end'
  ));

-- 2. Update existing Real Estate Showcase flow nodes from static
-- send_message to dynamic send_property_listings.
-- This only touches the 6 showcase nodes that currently have
-- hard-coded static property descriptions.
UPDATE flow_nodes
SET
  node_type = 'send_property_listings',
  config = CASE node_key
    WHEN 'villas_showcase' THEN jsonb_build_object(
      'intro_text', '🏡 *Properties for Sale*\n\nHere are our current listings:',
      'empty_text', '🏡 *Properties for Sale*\n\nSorry, no sale properties are currently available. Our team will reach out when something suitable is listed.',
      'limit', 5,
      'filter_listing_type', 'Sale',
      'next_node_key', 'collect_email'
    )
    WHEN 'apartments_showcase' THEN jsonb_build_object(
      'intro_text', '🏢 *Properties for Sale*\n\nHere are our current listings:',
      'empty_text', '🏢 *Properties for Sale*\n\nSorry, no sale properties are currently available. Our team will reach out when something suitable is listed.',
      'limit', 5,
      'filter_listing_type', 'Sale',
      'next_node_key', 'collect_email'
    )
    WHEN 'plots_showcase' THEN jsonb_build_object(
      'intro_text', '🌾 *Properties for Sale*\n\nHere are our current listings:',
      'empty_text', '🌾 *Properties for Sale*\n\nSorry, no sale properties are currently available. Our team will reach out when something suitable is listed.',
      'limit', 5,
      'filter_listing_type', 'Sale',
      'next_node_key', 'collect_email'
    )
    WHEN 'rent_2bhk_info' THEN jsonb_build_object(
      'intro_text', '🔑 *Properties for Rent*\n\nHere are our current rental listings:',
      'empty_text', '🔑 *Properties for Rent*\n\nSorry, no rental properties are currently available. Our team will reach out when something suitable is listed.',
      'limit', 5,
      'filter_listing_type', 'Rent',
      'next_node_key', 'collect_email'
    )
    WHEN 'rent_3bhk_info' THEN jsonb_build_object(
      'intro_text', '🔑 *Properties for Rent*\n\nHere are our current rental listings:',
      'empty_text', '🔑 *Properties for Rent*\n\nSorry, no rental properties are currently available. Our team will reach out when something suitable is listed.',
      'limit', 5,
      'filter_listing_type', 'Rent',
      'next_node_key', 'collect_email'
    )
    WHEN 'rent_commercial_info' THEN jsonb_build_object(
      'intro_text', '🏢 *Properties for Rent*\n\nHere are our current rental listings:',
      'empty_text', '🏢 *Properties for Rent*\n\nSorry, no rental properties are currently available. Our team will reach out when something suitable is listed.',
      'limit', 5,
      'filter_listing_type', 'Rent',
      'next_node_key', 'collect_email'
    )
    ELSE config  -- defensive fallback
  END
WHERE node_key IN (
  'villas_showcase',
  'apartments_showcase',
  'plots_showcase',
  'rent_2bhk_info',
  'rent_3bhk_info',
  'rent_commercial_info'
)
AND EXISTS (
  SELECT 1 FROM flows f
  WHERE f.id = flow_nodes.flow_id
  AND f.name = 'Real Estate Showcase'
);
