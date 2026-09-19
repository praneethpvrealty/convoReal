-- ============================================================
-- Both stage-sync triggers tightened.
--
-- Journey → deal: a journey item moved onto a mirrored stage moves its
-- deal only when that deal is on the mirrored pipeline. The mirror
-- reflects the account's default board; a deal on another board keeps
-- its own stage rather than being handed one from a pipeline it is
-- not on.
--
-- Deal → journey: the item a deal names through source_journey_item_id
-- is read and written only within the deal's own account. The trigger
-- is SECURITY DEFINER, so a deal pointing at a foreign item's UUID
-- must not reach that row.
--
-- Held until merge: CREATE OR REPLACE of live trigger functions.
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

CREATE OR REPLACE FUNCTION sync_journey_item_stage_from_deal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_js UUID;
  v_from UUID;
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.source_journey_item_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO v_js FROM journey_stages
    WHERE pipeline_stage_id = NEW.stage_id AND account_id = NEW.account_id;
  IF v_js IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT stage_id INTO v_from FROM journey_items
    WHERE id = NEW.source_journey_item_id AND account_id = NEW.account_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF v_from IS DISTINCT FROM v_js THEN
    UPDATE journey_items
      SET stage_id = v_js,
          status = 'active',
          drop_reason = NULL,
          dropped_at = NULL,
          planned_stage_id = NULL,
          planned_at = NULL
      WHERE id = NEW.source_journey_item_id AND account_id = NEW.account_id;
    INSERT INTO journey_events (account_id, item_id, event_type, from_stage_id, to_stage_id, created_by, metadata)
      VALUES (
        NEW.account_id,
        NEW.source_journey_item_id,
        'moved',
        v_from,
        v_js,
        auth.uid(),
        jsonb_build_object('synced_from_deal', NEW.id)
      );
  END IF;
  RETURN NEW;
END;
$$;
