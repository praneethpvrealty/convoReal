-- ============================================================
-- 20260929062349_add_journey_item_note.sql
-- Save a journey item note against the item's current stage in one
-- statement.
--
-- The item row is read FOR SHARE inside the INSERT … SELECT, so a
-- concurrent stage move either commits first (and the note takes the
-- new stage) or waits for the note, never tagging the note with a
-- stage the item has already left. SECURITY INVOKER keeps the
-- journey_stage_notes insert policy in force.
-- ============================================================

CREATE OR REPLACE FUNCTION public.add_journey_item_note(
  p_account_id UUID,
  p_item_id UUID,
  p_note TEXT
)
RETURNS SETOF journey_stage_notes
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO journey_stage_notes (
    account_id,
    item_id,
    stage_id,
    stage_name,
    stage_color,
    note,
    created_by,
    created_by_name
  )
  SELECT
    ji.account_id,
    ji.id,
    js.id,
    js.name,
    js.color,
    p_note,
    auth.uid(),
    (
      SELECT p.full_name
      FROM profiles p
      WHERE p.account_id = ji.account_id
        AND p.user_id = auth.uid()
      LIMIT 1
    )
  FROM journey_items ji
  JOIN journey_stages js
    ON js.id = ji.stage_id
   AND js.account_id = ji.account_id
  WHERE ji.id = p_item_id
    AND ji.account_id = p_account_id
  FOR SHARE OF ji
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.add_journey_item_note(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_journey_item_note(UUID, UUID, TEXT) TO authenticated;
