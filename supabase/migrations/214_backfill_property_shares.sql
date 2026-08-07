-- ============================================================
-- 214_backfill_property_shares.sql
-- One-time backfill of the property_shares ledger from the two
-- exact records of a confirmed share that predate it.
--
-- The ledger (migration 154) was only ever written by the web share
-- dialog, so shares sent from the mobile share sheet, the web
-- broadcast and the contact-approve route left no ledger row. The
-- Matching Contacts list reads that ledger to mark a recipient as
-- already contacted, so without this those recipients read as never
-- contacted and an agent re-sends to someone who already has it.
--
-- Sources, both exact contact×property pairs:
--   journey_items WHERE source = 'whatsapp_share'  (migration 138,
--     captured alongside every confirmed send by the share dialog)
--   contact_notes '📱 Shared via …' carrying '[PROP-1234]', written
--     by the external-share log on web and mobile
--
-- Deliberately NOT a source: scanning messages.content_text for a
-- property code. That matches the chatbot's catalog replies, which
-- list 5-15 properties at once in answer to a category browse — not
-- a deliberate share. On the reference account it produced 205 extra
-- pairs with near-zero overlap with the two sources above, which
-- would have greyed out contacts nobody ever sent anything to.
--
-- recipient_kind uses the contact's CURRENT classification. The
-- column exists to snapshot it at share time, but that history isn't
-- recoverable; new rows written by the app snapshot it correctly.
--
-- Idempotent: ON CONFLICT DO NOTHING against
-- UNIQUE(account_id, property_id, contact_id). Re-running inserts
-- nothing and never bumps an existing created_at.
-- ============================================================

INSERT INTO property_shares (
  account_id, property_id, contact_id, recipient_kind, channel, created_by, created_at, updated_at
)
SELECT
  d.account_id,
  d.property_id,
  d.contact_id,
  CASE WHEN c.classification = 'Agent' THEN 'agent' ELSE 'buyer' END,
  'whatsapp',
  d.created_by,
  d.shared_at,
  d.shared_at
FROM (
  SELECT
    account_id,
    property_id,
    contact_id,
    MIN(shared_at) AS shared_at,
    (ARRAY_AGG(created_by ORDER BY shared_at))[1] AS created_by
  FROM (
    SELECT j.account_id, j.property_id, j.contact_id, j.created_at AS shared_at, j.created_by
    FROM journey_items j
    WHERE j.source = 'whatsapp_share'

    UNION ALL

    -- '🏠 Property: [PROP-1234] Title' — the code is the join key;
    -- the title is display text and is not matched on.
    SELECT n.account_id, p.id, n.contact_id, n.created_at, n.user_id
    FROM contact_notes n
    JOIN properties p
      ON p.account_id = n.account_id
     AND p.property_code = (REGEXP_MATCH(n.note_text, '\[([A-Za-z]+-[0-9]+)\]'))[1]
    WHERE n.note_text LIKE '%Shared via%'
  ) candidates
  GROUP BY account_id, property_id, contact_id
) d
JOIN contacts c
  ON c.id = d.contact_id
 AND c.account_id = d.account_id
ON CONFLICT (account_id, property_id, contact_id) DO NOTHING;
