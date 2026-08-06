-- ============================================================
-- Say something useful when there is nothing to show.
--
-- A showcase branch that found no listings sent "Sorry, no rental
-- properties are currently available", then advanced to post_listings —
-- which asks "Interested in any of these? *Reply with its number*". A
-- lead who was shown nothing was asked to pick from it.
--
-- Every showcase branch now routes its empty case to no_match_followup,
-- which offers to keep watching. That offer is real rather than a
-- platitude: the requirement is already stored and extracted onto the
-- pref_* columns, so Match Radar evaluates every new listing against it
-- and the buyer digest picks it up.
--
-- Idempotent, and it only touches nodes still carrying the shipped
-- empty_text, so a reworded branch keeps its own copy.
-- ============================================================

-- The follow-up and its confirmation, added once per flow that has the
-- nodes they hand off to.
INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y)
SELECT f.id, 'no_match_followup', 'send_buttons',
  jsonb_build_object(
    'text', 'Shall I keep you posted the moment something matches? 🔔',
    'buttons', jsonb_build_array(
      jsonb_build_object('reply_id', 'subscribe_matches', 'title', 'Yes, keep me posted', 'next_node_key', 'match_subscribed'),
      jsonb_build_object('reply_id', 'browse_other', 'title', 'See other options', 'next_node_key', 'buy_menu'),
      jsonb_build_object('reply_id', 'talk_to_agent_nomatch', 'title', 'Talk to an Agent', 'next_node_key', 'thank_you')
    ),
    'interest_node_key', 'thank_you'
  ),
  0, 1400
FROM flows f
WHERE EXISTS (SELECT 1 FROM flow_nodes n WHERE n.flow_id = f.id AND n.node_key = 'thank_you')
  AND EXISTS (SELECT 1 FROM flow_nodes n WHERE n.flow_id = f.id AND n.node_key = 'buy_menu')
  AND NOT EXISTS (SELECT 1 FROM flow_nodes n WHERE n.flow_id = f.id AND n.node_key = 'no_match_followup');

INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y)
SELECT f.id, 'match_subscribed', 'send_message',
  jsonb_build_object(
    'text', '✅ *You''re on the list.*

I''ve saved what you''re after — type, budget and area — and the engine now watches every new listing against it. The moment one matches, you''ll get a message here. No need to check back.',
    'next_node_key', 'handoff_onboarding'
  ),
  260, 1400
FROM flows f
WHERE EXISTS (SELECT 1 FROM flow_nodes n WHERE n.flow_id = f.id AND n.node_key = 'handoff_onboarding')
  AND NOT EXISTS (SELECT 1 FROM flow_nodes n WHERE n.flow_id = f.id AND n.node_key = 'match_subscribed');

-- Point every showcase branch's empty case at it, and replace the
-- apologetic copy.
UPDATE flow_nodes n
SET config = n.config
  || jsonb_build_object(
       'empty_next_node_key', 'no_match_followup',
       'empty_text', '🔍 *Nothing matching that in our live listings right now.*

Don''t lose hope — this is where the engine earns its keep. It keeps hunting as new properties come in, and the moment one fits what you''ve told me, you''ll hear about it here.'
     )
WHERE n.node_type = 'send_property_listings'
  AND n.config->'empty_next_node_key' IS NULL
  AND (n.config->>'empty_text' LIKE '%Sorry, no%'
       OR n.config->>'empty_text' LIKE '%Nothing available right now%')
  AND EXISTS (
    SELECT 1 FROM flow_nodes f2
    WHERE f2.flow_id = n.flow_id AND f2.node_key = 'no_match_followup'
  );
