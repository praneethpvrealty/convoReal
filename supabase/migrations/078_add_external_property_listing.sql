-- ============================================================
-- 078_add_external_property_listing.sql
-- Lets external agents/property owners list a property over
-- WhatsApp via the "List My Property" menu option. Submissions
-- land in inventory as 'Pending Review' until the account owner
-- approves them (see property-list.tsx / inventory page.tsx).
-- ============================================================

-- 1. New listing_source value for properties submitted by an
-- external (non-staff) WhatsApp sender, distinct from 'owner'
-- (the account owner's own AI chatbot) and 'agent' (an internal
-- referral contact classified as Agent).
ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_listing_source_check;

ALTER TABLE properties
  ADD CONSTRAINT properties_listing_source_check
  CHECK (listing_source IN ('owner', 'agent', 'whatsapp_lister'));

-- 2. Tag draft sessions as belonging to the account owner's AI
-- chatbot vs. an external lister's WhatsApp intake, so the webhook
-- can route follow-up messages without re-deriving intent.
ALTER TABLE property_draft_sessions
  ADD COLUMN IF NOT EXISTS session_mode TEXT NOT NULL DEFAULT 'owner'
  CHECK (session_mode IN ('owner', 'external'));

-- 3. New terminal flow node type: sends the listing-intake prompt
-- and starts an external draft session, then ends the run (the
-- session-based chatbot takes over from here, same as a handoff).
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
    'start_property_intake',
    'http_fetch',
    'end'
  ));

-- 4. Backfill: accounts that already cloned the "Real Estate
-- Showcase" template have a 'seller_handoff' node of type 'handoff'
-- that dead-ends the "List My Property" button. Flip it to the new
-- node type so existing accounts pick this up without recloning.
UPDATE flow_nodes
SET
  node_type = 'start_property_intake',
  config = jsonb_build_object(
    'intro_text', '📋 *List Your Property*\n\nSend photos and/or details of your property (location, price, BHK, etc.) as text or images, and we''ll put together the listing for you.\n\nType *cancel* anytime to stop.'
  )
WHERE node_key = 'seller_handoff'
  AND node_type = 'handoff'
  AND EXISTS (
    SELECT 1 FROM flows f
    WHERE f.id = flow_nodes.flow_id
    AND f.name = 'Real Estate Showcase'
  );
