-- ============================================================
-- 140_journey_planned_steps.sql
-- Planned next steps on the Journey mind map.
--
-- An active contact×property pair can carry ONE planned next step:
-- which stage it's expected to reach and by when. The canvas renders
-- it as a ghost card at the planned stage's column, connected to the
-- frontier by a grey dotted edge labelled "In 25 days" / "Today" /
-- "N days overdue" — visibly not-reached-yet. Moving the item to any
-- stage clears the plan (it was for the next move).
--
--   journey_items.planned_stage_id — expected stage (SET NULL if the
--                                    stage is deleted)
--   journey_items.planned_at       — expected date (day granularity)
--   journey_events                 — gains 'planned' / 'plan_cleared'
-- ============================================================

ALTER TABLE journey_items
  ADD COLUMN IF NOT EXISTS planned_stage_id UUID REFERENCES journey_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS planned_at DATE;

COMMENT ON COLUMN journey_items.planned_stage_id IS
  'Expected next stage for this pair — rendered as a ghost node on the mind map until reached or cleared.';
COMMENT ON COLUMN journey_items.planned_at IS
  'Expected date for the planned next stage; drives the "In N days" label on the dotted edge.';

ALTER TABLE journey_events
  DROP CONSTRAINT IF EXISTS journey_events_event_type_check;
ALTER TABLE journey_events
  ADD CONSTRAINT journey_events_event_type_check
    CHECK (event_type IN ('added', 'advanced', 'moved', 'dropped', 'reactivated', 'hidden', 'unhidden', 'planned', 'plan_cleared'));
