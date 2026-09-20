-- Show captured journey items and log their 'unhidden' events in one
-- transaction. Both surfaces call this instead of writing journey_items
-- and journey_events separately, so a promoted item can never be missing
-- its history and only the ids the agent reviewed are promoted.

CREATE OR REPLACE FUNCTION public.journey_show_captured(
  p_account_id UUID,
  p_item_ids UUID[]
)
RETURNS SETOF UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_item_ids IS NULL
     OR cardinality(p_item_ids) = 0
     OR NOT is_account_member(p_account_id, 'agent') THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH shown AS (
    UPDATE journey_items
    SET hidden = FALSE
    WHERE account_id = p_account_id
      AND hidden
      AND id = ANY(p_item_ids)
    RETURNING id, stage_id
  ),
  logged AS (
    INSERT INTO journey_events (
      account_id, item_id, event_type, from_stage_id, to_stage_id, created_by
    )
    SELECT p_account_id, shown.id, 'unhidden', shown.stage_id, shown.stage_id,
           (SELECT auth.uid())
    FROM shown
    RETURNING item_id
  )
  SELECT item_id FROM logged;
END;
$$;

COMMENT ON FUNCTION public.journey_show_captured(UUID, UUID[]) IS
  'Promotes the given hidden journey items of the caller''s account onto the journey and records an unhidden event for each in the same transaction. Returns the ids that were promoted.';
