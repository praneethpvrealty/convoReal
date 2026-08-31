-- ============================================================
-- Carry the alerts-subscription change into flows already seeded.
--
-- A flow is copied out of the template into flow_nodes when it is
-- created, so editing src/lib/flows/templates.ts only changes flows
-- made from then on (see 200_flow_listing_interest_copy.sql). The
-- engine half is live code everywhere, but it grants consent only when
-- the STORED node config carries the flag — so without this, every
-- account already running the onboarding flow keeps telling leads
-- "you're on the list" and enrolling nobody.
--
-- The budget contexts come along for the same reason: they were added
-- to the template in #762 and, being absent from stored rows, make the
-- engine ask for a budget it already holds. Adding them is safe in the
-- other direction too — a stored budget is reused only when the
-- contact's stated intent matches the branch.
--
-- Every statement is matched on the exact previously-shipped values, so
-- an account that reworded or reconfigured a node in the flow builder
-- keeps its own version.
-- ============================================================

UPDATE flow_nodes
SET config =
      jsonb_set(
        jsonb_set(config, '{grants_alerts_consent}', 'true'::jsonb),
        '{text}',
        to_jsonb(
          E'✅ *You''re on the list.*\n\nI''ve saved what you''re after — type, budget and area — and the engine now watches every new listing against it. The moment one matches, you''ll get a message here. No need to check back.\n\nAnd you don''t have to wait for me: our full catalogue is open to browse whenever you like, at the link above.\n\n_Reply STOP ALERTS anytime to turn these off._'::text
        )
      )
WHERE node_key = 'match_subscribed'
  AND node_type = 'send_message'
  AND config->>'text' = E'✅ *You''re on the list.*\n\nI''ve saved what you''re after — type, budget and area — and the engine now watches every new listing against it. The moment one matches, you''ll get a message here. No need to check back.';

UPDATE flow_nodes
SET config = jsonb_set(config, '{budget_context}', '"sale"'::jsonb)
WHERE node_key = 'ask_buy_budget'
  AND node_type = 'collect_input'
  AND config->>'var_key' = 'budget'
  AND config->>'budget_context' IS NULL;

UPDATE flow_nodes
SET config = jsonb_set(config, '{budget_context}', '"rent"'::jsonb)
WHERE node_key = 'ask_rent_budget'
  AND node_type = 'collect_input'
  AND config->>'var_key' = 'budget'
  AND config->>'budget_context' IS NULL;
