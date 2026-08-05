-- ============================================================
-- Ask a lead which area they want.
--
-- The funnel collected intent and budget and then went straight to the
-- category menu, so matching had two of the three fields it needs and
-- locality — the one that decides whether a listing is worth showing at
-- all — was never asked for. src/lib/flows/engine.ts now puts listings
-- in the named area first, ahead of the budget split, but only for runs
-- that captured a `locality` var.
--
-- Inserts the two collect_input nodes into flows already seeded and
-- points the budget steps at them. Idempotent: skips a flow that
-- already has the node, and only re-points a budget step still aimed at
-- the menu, so a hand-rewired flow is left alone.
-- ============================================================

INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y)
SELECT
  budget.flow_id,
  replace(budget.node_key, 'budget', 'locality'),
  'collect_input',
  jsonb_build_object(
    'prompt_text',
    '📍 Which area are you looking at? Tell me a locality or two and I''ll show you what we have there.

_For example: Koramangala, HSR Layout, Whitefield_',
    'var_key', 'locality',
    'next_node_key', budget.config->>'next_node_key'
  ),
  COALESCE(budget.position_x, 0),
  COALESCE(budget.position_y, 0) + 120
FROM flow_nodes budget
WHERE budget.node_key IN ('ask_buy_budget', 'ask_rent_budget')
  AND budget.node_type = 'collect_input'
  AND budget.config->>'next_node_key' IN ('buy_menu', 'rent_menu')
  AND NOT EXISTS (
    SELECT 1 FROM flow_nodes existing
    WHERE existing.flow_id = budget.flow_id
      AND existing.node_key = replace(budget.node_key, 'budget', 'locality')
  );

UPDATE flow_nodes budget
SET config = jsonb_set(
      budget.config,
      '{next_node_key}',
      to_jsonb(replace(budget.node_key, 'budget', 'locality'))
    )
WHERE budget.node_key IN ('ask_buy_budget', 'ask_rent_budget')
  AND budget.node_type = 'collect_input'
  AND budget.config->>'next_node_key' IN ('buy_menu', 'rent_menu')
  AND EXISTS (
    SELECT 1 FROM flow_nodes locality
    WHERE locality.flow_id = budget.flow_id
      AND locality.node_key = replace(budget.node_key, 'budget', 'locality')
  );
