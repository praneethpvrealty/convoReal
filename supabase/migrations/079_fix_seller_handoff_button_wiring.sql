-- ============================================================
-- 079_fix_seller_handoff_button_wiring.sql
-- Fixes a pre-existing data-drift bug: on accounts that cloned the
-- "Real Estate Showcase" template, the welcome node's "List My
-- Property" button (reply_id 'list') points at 'post_listings' (the
-- buy/rent showcase CTA menu) instead of 'seller_handoff' — a stale
-- target left over from before the dedicated seller node existed.
-- Current templates.ts already wires 'list' -> 'seller_handoff'
-- correctly for NEW clones; this backfills existing ones so the
-- start_property_intake node added in migration 078 is actually
-- reachable.
-- ============================================================

UPDATE flow_nodes fn
SET config = jsonb_set(
  fn.config,
  '{buttons}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN btn->>'reply_id' = 'list' THEN jsonb_set(btn, '{next_node_key}', '"seller_handoff"')
        ELSE btn
      END
    )
    FROM jsonb_array_elements(fn.config->'buttons') AS btn
  )
)
WHERE fn.node_key = 'welcome'
  AND fn.node_type = 'send_buttons'
  AND fn.config->'buttons' @> '[{"reply_id": "list", "next_node_key": "post_listings"}]'::jsonb
  AND EXISTS (
    SELECT 1 FROM flows f
    WHERE f.id = fn.flow_id
    AND f.name = 'Real Estate Showcase'
  );
