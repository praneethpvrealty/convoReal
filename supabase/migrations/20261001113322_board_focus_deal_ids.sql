-- The Board's Focus view: the deals on one pipeline whose buyer or
-- listing journey sits in the Focus compartment and is still active on
-- the Journey (not paused, closed or archived). Focus follows the
-- account's compartment scope: the shared team row, or the caller's own
-- row when each agent keeps their own. Web and mobile both read it, so
-- the rule lives in one place.
--
-- Purely additive: a new function.

CREATE OR REPLACE FUNCTION board_focus_deal_ids(
  target_account_id UUID,
  target_pipeline_id UUID
)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH owner AS (
    SELECT CASE WHEN a.journey_compartment_scope = 'agent' THEN auth.uid() END AS user_id
    FROM accounts a
    WHERE a.id = target_account_id
      AND is_account_member(target_account_id)
  ),
  focus AS (
    SELECT jc.mode, jc.subject_id
    FROM journey_compartments jc
    JOIN owner o ON jc.user_id IS NOT DISTINCT FROM o.user_id
    WHERE jc.account_id = target_account_id
      AND jc.compartment = 'focus'
      AND NOT EXISTS (
        SELECT 1 FROM journey_overview_states s
        WHERE s.account_id = jc.account_id
          AND s.mode = jc.mode
          AND s.subject_id = jc.subject_id
          AND (s.lifecycle_status <> 'active' OR s.archived_at IS NOT NULL)
      )
  )
  SELECT d.id
  FROM deals d
  WHERE d.account_id = target_account_id
    AND d.pipeline_id = target_pipeline_id
    AND EXISTS (
      SELECT 1 FROM focus f
      WHERE (f.mode = 'buyer' AND f.subject_id = d.contact_id)
         OR (f.mode = 'property' AND f.subject_id = d.property_id)
    );
$$;

REVOKE ALL ON FUNCTION board_focus_deal_ids(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION board_focus_deal_ids(UUID, UUID) TO authenticated;
