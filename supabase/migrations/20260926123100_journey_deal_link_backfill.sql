-- Backfill the deal ↔ journey link for deals that predate
-- journey_link_deal (…123000): every deal with a contact and a property
-- is linked to that pair's journey branch, created at the deal's
-- mirrored stage when the pair was never on the journey, and the
-- branch's stage and status are aligned to the deal. A second deal for
-- the same pair stays unlinked, as the trigger leaves it.
--
-- Two statements: rows a data-modifying CTE inserts are not visible to
-- the other CTEs of the same statement, so the branches are created
-- first and linked second.
--
-- Data backfill: held until the PR carrying …123000 is merged.

-- 1. Branches for pairs that were never on the journey.
WITH first_stage AS (
  SELECT DISTINCT ON (account_id) account_id, id
  FROM journey_stages
  WHERE pipeline_stage_id IS NOT NULL
  ORDER BY account_id, position, id
),
first_deal AS (
  SELECT DISTINCT ON (d.account_id, d.contact_id, d.property_id)
    d.account_id, d.contact_id, d.property_id, d.user_id, d.status AS deal_status,
    COALESCE(js.id, fs.id) AS stage_id, d.created_at
  FROM deals d
  JOIN first_stage fs ON fs.account_id = d.account_id
  JOIN contacts c ON c.id = d.contact_id AND c.account_id = d.account_id
  JOIN properties p ON p.id = d.property_id AND p.account_id = d.account_id
  LEFT JOIN journey_stages js
    ON js.pipeline_stage_id = d.stage_id AND js.account_id = d.account_id
  WHERE d.source_journey_item_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM journey_items ji
      WHERE ji.account_id = d.account_id
        AND ji.contact_id = d.contact_id
        AND ji.property_id = d.property_id
    )
  ORDER BY d.account_id, d.contact_id, d.property_id, d.created_at
),
created AS (
  INSERT INTO journey_items (
    account_id, contact_id, property_id, stage_id, source, hidden,
    status, drop_reason, dropped_at, created_by, created_at, updated_at
  )
  SELECT
    account_id, contact_id, property_id, stage_id, 'manual', FALSE,
    CASE WHEN deal_status = 'lost' THEN 'dropped' ELSE 'active' END,
    CASE WHEN deal_status = 'lost' THEN 'Deal marked lost' END,
    CASE WHEN deal_status = 'lost' THEN created_at END,
    user_id, created_at, created_at
  FROM first_deal
  ON CONFLICT (account_id, contact_id, property_id) DO NOTHING
  RETURNING id, account_id, stage_id, created_by, created_at
)
INSERT INTO journey_events (
  account_id, item_id, event_type, to_stage_id, reason, created_by, created_at
)
SELECT account_id, id, 'added', stage_id, 'Captured from deal', created_by, created_at
FROM created;

-- 2. Link the earliest unlinked deal of each pair to its branch and
--    align the branch to the deal.
WITH candidates AS (
  SELECT DISTINCT ON (d.account_id, d.contact_id, d.property_id)
    d.id AS deal_id, d.account_id, d.contact_id, d.property_id, d.user_id,
    d.status AS deal_status, js.id AS mirrored_stage_id
  FROM deals d
  JOIN contacts c ON c.id = d.contact_id AND c.account_id = d.account_id
  JOIN properties p ON p.id = d.property_id AND p.account_id = d.account_id
  LEFT JOIN journey_stages js
    ON js.pipeline_stage_id = d.stage_id AND js.account_id = d.account_id
  WHERE d.source_journey_item_id IS NULL
  ORDER BY d.account_id, d.contact_id, d.property_id, d.created_at
),
linked AS (
  UPDATE deals d
  SET source_journey_item_id = ji.id
  FROM candidates cnd
  JOIN journey_items ji
    ON ji.account_id = cnd.account_id
   AND ji.contact_id = cnd.contact_id
   AND ji.property_id = cnd.property_id
  WHERE d.id = cnd.deal_id
    AND NOT EXISTS (
      SELECT 1 FROM deals other
      WHERE other.source_journey_item_id = ji.id AND other.id <> d.id
    )
  RETURNING d.id AS deal_id, d.account_id, d.status AS deal_status, d.user_id,
            ji.id AS item_id, ji.stage_id AS item_stage, ji.status AS item_status,
            ji.hidden AS item_hidden, cnd.mirrored_stage_id
),
aligned AS (
  UPDATE journey_items ji
  SET stage_id = COALESCE(l.mirrored_stage_id, ji.stage_id),
      status = CASE WHEN l.deal_status = 'lost' THEN 'dropped' ELSE 'active' END,
      hidden = FALSE,
      drop_reason = CASE WHEN l.deal_status = 'lost'
                         THEN COALESCE(ji.drop_reason, 'Deal marked lost') END,
      dropped_at = CASE WHEN l.deal_status = 'lost'
                        THEN COALESCE(ji.dropped_at, NOW()) END,
      planned_stage_id = NULL,
      planned_at = NULL
  FROM linked l
  WHERE ji.id = l.item_id
    AND (l.item_stage IS DISTINCT FROM COALESCE(l.mirrored_stage_id, l.item_stage)
         OR l.item_status IS DISTINCT FROM
            CASE WHEN l.deal_status = 'lost' THEN 'dropped' ELSE 'active' END
         OR l.item_hidden)
  RETURNING ji.id, ji.account_id, l.item_stage, ji.stage_id AS to_stage,
            l.item_status, ji.status AS to_status, l.deal_id, l.deal_status, l.user_id
)
INSERT INTO journey_events (
  account_id, item_id, event_type, from_stage_id, to_stage_id, created_by, metadata
)
SELECT
  account_id, id,
  CASE
    WHEN to_status = 'dropped' AND item_status IS DISTINCT FROM 'dropped' THEN 'dropped'
    WHEN to_status = 'active' AND item_status = 'dropped' THEN 'reactivated'
    ELSE 'moved'
  END,
  item_stage, to_stage, user_id,
  jsonb_build_object('synced_from_deal', deal_id, 'deal_status', deal_status, 'backfill', true)
FROM aligned;
