-- ============================================================
-- Carry the listing-interest change into flows already seeded.
--
-- A flow is copied out of the template into flow_nodes when it is
-- created, so editing src/lib/flows/templates.ts only changes flows
-- made from then on. The engine half of the change (numbering the
-- listings, resolving a "2" reply, filing the inquiry) is live code and
-- already applies everywhere — but the lead is never told to reply with
-- a number, and the agent's handoff note still omits which property
-- prompted the handoff, because both strings live in these rows.
--
-- Matched on the exact previously-shipped strings so an account that
-- reworded either node in the flow builder keeps its own copy.
-- ============================================================

UPDATE flow_nodes
SET config = jsonb_set(
      config,
      '{text}',
      to_jsonb(
        'Interested in any of these? *Reply with its number* (e.g. 2) and I''ll have our specialist send photos, full details and arrange a site visit. 👇'::text
      )
    )
WHERE node_key = 'post_listings'
  AND node_type = 'send_buttons'
  AND config->>'text' = 'Interested in any of these? Our specialist can share more details, photos, and arrange a site visit. 👇';

UPDATE flow_nodes
SET config = jsonb_set(
      config,
      '{note}',
      to_jsonb(
        'Real Estate Buyer/Tenant Lead! Budget: {{vars.budget}}. Interested in: {{vars.interested_property}}. Captured email: {{vars.email}}.'::text
      )
    )
WHERE node_key = 'handoff_onboarding'
  AND node_type = 'handoff'
  AND config->>'note' = 'Real Estate Buyer/Tenant Lead! Budget: {{vars.budget}}. Captured email: {{vars.email}}.';
