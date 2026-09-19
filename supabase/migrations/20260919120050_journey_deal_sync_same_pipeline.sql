-- ============================================================
-- A journey item moved onto a mirrored stage moves its deal only when
-- that deal is on the mirrored pipeline. The mirror reflects the
-- account's default board; a deal on another board keeps its own
-- stage rather than being handed one from a pipeline it is not on.
--
-- Held until merge: CREATE OR REPLACE of a live trigger function.
-- Applied before the backfill (…120100), which relies on it.
-- ============================================================

CREATE OR REPLACE FUNCTION sync_deal_stage_from_journey_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ps UUID;
  v_kind TEXT;
  v_pipeline UUID;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  SELECT js.pipeline_stage_id, js.stage_kind, ps.pipeline_id
    INTO v_ps, v_kind, v_pipeline
    FROM journey_stages js
    JOIN pipeline_stages ps ON ps.id = js.pipeline_stage_id
    WHERE js.id = NEW.stage_id;
  IF v_ps IS NULL THEN
    RETURN NEW;
  END IF;
  UPDATE deals
    SET stage_id = v_ps,
        status = CASE v_kind WHEN 'won' THEN 'won' WHEN 'lost' THEN 'lost' ELSE 'open' END
    WHERE source_journey_item_id = NEW.id
      AND account_id = NEW.account_id
      AND pipeline_id = v_pipeline
      AND stage_id IS DISTINCT FROM v_ps;
  RETURN NEW;
END;
$$;
