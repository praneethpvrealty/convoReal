-- Open the Board deal for every visible, active journey branch that
-- predates journey_auto_open_deal (…032159), through the same function
-- the trigger calls, so the Board shows every live branch at its stage.
--
-- Data backfill: held until the PR carrying …032159 is merged.

SELECT journey_open_deal_for_item(ji.id)
FROM journey_items ji
JOIN journey_stages js ON js.id = ji.stage_id AND js.account_id = ji.account_id
WHERE NOT ji.hidden
  AND ji.status = 'active'
  AND js.pipeline_stage_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM deals d
    WHERE d.account_id = ji.account_id AND d.source_journey_item_id = ji.id
  )
ORDER BY ji.created_at;
