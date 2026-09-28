-- ============================================================
-- Re-sync a stage's deals after its meaning changes.
--
-- Changing a populated stage's stage_type in Manage Pipeline (say from
-- open to committed) changes how the board, journey and listing read
-- it, but the deals already on it kept the status their old meaning
-- gave them and their listings kept their old status. This function
-- brings them in line: each deal takes the status the new type implies
-- (won for won and brokerage stages, lost for lost, open otherwise) and
-- every listing those deals hold is re-synced through the one listing
-- status function.
--
-- Additive: a new function. Only Manage Pipeline calls it, after a save
-- that changed a stage's type.
-- ============================================================

CREATE OR REPLACE FUNCTION resync_pipeline_stage_deals(p_stage_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account UUID;
  v_type TEXT;
  v_status TEXT;
  v_count INTEGER := 0;
  v_prop RECORD;
BEGIN
  SELECT p.account_id, s.stage_type
    INTO v_account, v_type
    FROM pipeline_stages s
    JOIN pipelines p ON p.id = s.pipeline_id
    WHERE s.id = p_stage_id;
  IF v_account IS NULL THEN
    RETURN 0;
  END IF;
  IF NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'not an admin on this account' USING ERRCODE = '42501';
  END IF;

  v_status := CASE
    WHEN v_type = 'lost' THEN 'lost'
    WHEN v_type IN ('won', 'brokerage_pending', 'brokerage_paid') THEN 'won'
    ELSE 'open'
  END;

  UPDATE deals
    SET status = v_status
    WHERE stage_id = p_stage_id
      AND account_id = v_account
      AND status IS DISTINCT FROM v_status;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  FOR v_prop IN
    SELECT DISTINCT property_id
      FROM deals
      WHERE stage_id = p_stage_id
        AND account_id = v_account
        AND property_id IS NOT NULL
  LOOP
    PERFORM sync_listing_status_from_deals(v_account, v_prop.property_id, 'Available');
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION resync_pipeline_stage_deals(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resync_pipeline_stage_deals(uuid) TO authenticated;
