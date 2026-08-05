-- ============================================================
-- Stop the email step swallowing a lead who asked for a human.
--
-- "Talk to an Agent" routed to collect_email, and the handoff node sat
-- behind it. A lead who tapped the button and then did not type an
-- email address — the common case on WhatsApp, where nobody has their
-- address to hand — left the run suspended at the prompt forever. The
-- handoff never fired, so nothing marked the conversation pending and
-- (as of this release) nothing notified an agent either.
--
-- The button now goes straight to thank_you, which sends the
-- reassurance message and then advances into the handoff. Email is no
-- longer collected on this path: the account already has the lead's
-- WhatsApp number and an open service window.
--
-- collect_email stays in the graph, unreferenced, so a flow that has
-- been rewired by hand in the builder keeps whatever it points at.
-- Matched on the exact previously-shipped values so a reworded or
-- re-pointed node is left alone.
-- ============================================================

UPDATE flow_nodes
SET config = jsonb_set(
      config,
      '{buttons}',
      (
        SELECT jsonb_agg(
                 CASE
                   WHEN button->>'reply_id' = 'talk_to_agent'
                     THEN jsonb_set(button, '{next_node_key}', '"thank_you"'::jsonb)
                   ELSE button
                 END
                 ORDER BY ordinality
               )
        FROM jsonb_array_elements(config->'buttons') WITH ORDINALITY AS t(button, ordinality)
      )
    )
WHERE node_key = 'post_listings'
  AND node_type = 'send_buttons'
  AND config->'buttons' @> '[{"reply_id":"talk_to_agent","next_node_key":"collect_email"}]'::jsonb;

UPDATE flow_nodes
SET config = jsonb_set(
      config,
      '{text}',
      to_jsonb(
        '🙏 *Thank you!* One of our specialists is being notified right now and will call you shortly with options that fit your budget.

For anything urgent, call us on *{{account.contact_phone}}*

We look forward to helping you find your perfect property! 🏡'::text
      )
    )
WHERE node_key = 'thank_you'
  AND node_type = 'send_message'
  AND config->>'text' LIKE '🙏 *Thank you!* We''ve received your details%';
