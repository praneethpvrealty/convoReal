-- ============================================================
-- A pipeline stage cannot be deleted while journey items sit on (or
-- plan for) its mirrored journey stage: the FK is ON DELETE SET NULL,
-- which would leave those items on a stage the rail no longer lists.
-- A mirrored stage that nothing references goes with its pipeline
-- stage instead of lingering unlinked.
--
-- Additive: a new function and a new trigger on pipeline_stages.
-- ============================================================

CREATE OR REPLACE FUNCTION guard_pipeline_stage_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_js UUID;
  v_items INT;
BEGIN
  SELECT id INTO v_js FROM journey_stages WHERE pipeline_stage_id = OLD.id;
  IF v_js IS NULL THEN
    RETURN OLD;
  END IF;
  SELECT count(*) INTO v_items
    FROM journey_items
    WHERE stage_id = v_js OR planned_stage_id = v_js;
  IF v_items > 0 THEN
    RAISE EXCEPTION 'Move the % journey item(s) out of "%" before deleting this stage',
      v_items, OLD.name
      USING ERRCODE = '23001';
  END IF;
  DELETE FROM journey_stages s
    WHERE s.id = v_js
      AND NOT EXISTS (SELECT 1 FROM journey_stage_notes n WHERE n.stage_id = s.id);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS guard_pipeline_stage_delete_trigger ON pipeline_stages;
CREATE TRIGGER guard_pipeline_stage_delete_trigger
  BEFORE DELETE ON pipeline_stages
  FOR EACH ROW
  EXECUTE FUNCTION guard_pipeline_stage_delete();
