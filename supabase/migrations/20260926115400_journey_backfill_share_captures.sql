-- Backfill journey captures for property shares that never reached the
-- journey. The browser wrote the share ledger and the journey capture as
-- two separate requests behind only the share dialog's broadcast paths,
-- and every server-side share surface wrote the ledger alone, so from
-- mid-August almost every share has a property_shares row and no
-- journey_items row. The ledger writer now captures the pair itself; this
-- puts the pairs it missed into each contact's Captured tray (hidden, at
-- the account's first mirrored stage), with the 'added' event the capture
-- would have logged, dated to the share. Pairs already on the journey are
-- left exactly as they are.

WITH first_stage AS (
  SELECT DISTINCT ON (account_id) account_id, id
  FROM journey_stages
  WHERE pipeline_stage_id IS NOT NULL
  ORDER BY account_id, position, id
),
missing AS (
  SELECT
    s.account_id,
    s.contact_id,
    s.property_id,
    fs.id AS stage_id,
    s.created_by,
    s.created_at
  FROM property_shares s
  JOIN first_stage fs ON fs.account_id = s.account_id
  JOIN contacts c ON c.id = s.contact_id AND c.account_id = s.account_id
  JOIN properties p ON p.id = s.property_id AND p.account_id = s.account_id
  WHERE NOT EXISTS (
    SELECT 1 FROM journey_items ji
    WHERE ji.account_id = s.account_id
      AND ji.contact_id = s.contact_id
      AND ji.property_id = s.property_id
  )
),
inserted AS (
  INSERT INTO journey_items (
    account_id, contact_id, property_id, stage_id, source, hidden,
    created_by, created_at, updated_at
  )
  SELECT
    account_id, contact_id, property_id, stage_id, 'whatsapp_share', TRUE,
    created_by, created_at, created_at
  FROM missing
  ON CONFLICT (account_id, contact_id, property_id) DO NOTHING
  RETURNING id, account_id, stage_id, created_by, created_at
)
INSERT INTO journey_events (
  account_id, item_id, event_type, to_stage_id, reason, created_by, created_at
)
SELECT
  account_id, id, 'added', stage_id, 'Captured from WhatsApp share',
  created_by, created_at
FROM inserted;
