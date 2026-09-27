-- The last two ways the Journey and the Board could part:
--
--   * Closing a journey on the overview (completed / not proceeding)
--     hid it from the Journey tab and left every one of its deals open
--     on the Board, in the Dashboard's open-deal count and in Records.
--   * Deleting a deal left its branch live at Negotiation or beyond,
--     offering "Convert to deal" again.
--
-- Closing a journey now drops its live branches — all of them for
-- "not proceeding", every one but the won branch for "completed" — and
-- their deals go lost on the board's lost stage. Reopening reverses
-- exactly the branches the close dropped and nothing else. Deleting a
-- deal drops its branch with the reason on record. Pausing and
-- archiving change nothing: a paused search is still a search, and
-- archive is a view state.
--
-- The item ↔ deal triggers from …123000 skip at trigger depth > 1, so
-- these functions carry the deal side themselves rather than relying
-- on a nested fire.
--
-- Held until merge: triggers on live tables.

CREATE OR REPLACE FUNCTION journey_close_branches(
  p_account_id UUID,
  p_mode TEXT,
  p_subject_id UUID,
  p_reason TEXT,
  p_keep_won BOOLEAN,
  p_actor UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH dropped AS (
    UPDATE journey_items ji
    SET status = 'dropped',
        drop_reason = p_reason,
        dropped_at = NOW(),
        planned_stage_id = NULL,
        planned_at = NULL
    FROM journey_stages js
    WHERE js.id = ji.stage_id
      AND ji.account_id = p_account_id
      AND ji.status = 'active'
      AND NOT ji.hidden
      AND CASE p_mode
            WHEN 'buyer' THEN ji.contact_id = p_subject_id
            ELSE ji.property_id = p_subject_id
          END
      AND NOT (p_keep_won AND js.stage_kind = 'won')
    RETURNING ji.id AS item_id, ji.stage_id
  ),
  logged AS (
    INSERT INTO journey_events (account_id, item_id, event_type, from_stage_id, to_stage_id, reason, created_by, metadata)
    SELECT p_account_id, item_id, 'dropped', stage_id, stage_id, p_reason, p_actor,
           jsonb_build_object('journey_closed', true, 'mode', p_mode, 'subject_id', p_subject_id)
    FROM dropped
  ),
  lost_deals AS (
    UPDATE deals d
    SET status = 'lost',
        stage_id = COALESCE(lost.id, d.stage_id)
    FROM dropped c
    JOIN journey_stages js ON js.id = c.stage_id
    JOIN pipeline_stages ps ON ps.id = js.pipeline_stage_id
    LEFT JOIN LATERAL (
      SELECT lps.id
      FROM pipeline_stages lps
      JOIN journey_stages ljs ON ljs.pipeline_stage_id = lps.id
      WHERE lps.pipeline_id = ps.pipeline_id
        AND ljs.account_id = p_account_id
        AND ljs.stage_kind = 'lost'
      ORDER BY lps.position
      LIMIT 1
    ) lost ON TRUE
    WHERE d.source_journey_item_id = c.item_id
      AND d.account_id = p_account_id
      AND d.pipeline_id = ps.pipeline_id
      AND (d.status IS DISTINCT FROM 'lost'
           OR d.stage_id IS DISTINCT FROM COALESCE(lost.id, d.stage_id))
  )
  SELECT count(*) INTO v_count FROM dropped;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION journey_reopen_branches(
  p_account_id UUID,
  p_mode TEXT,
  p_subject_id UUID,
  p_actor UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH reopened AS (
    UPDATE journey_items ji
    SET status = 'active',
        drop_reason = NULL,
        dropped_at = NULL
    WHERE ji.account_id = p_account_id
      AND ji.status = 'dropped'
      AND ji.drop_reason LIKE 'Journey closed:%'
      AND CASE p_mode
            WHEN 'buyer' THEN ji.contact_id = p_subject_id
            ELSE ji.property_id = p_subject_id
          END
    RETURNING ji.id AS item_id, ji.stage_id
  ),
  logged AS (
    INSERT INTO journey_events (account_id, item_id, event_type, from_stage_id, to_stage_id, created_by, metadata)
    SELECT p_account_id, item_id, 'reactivated', stage_id, stage_id, p_actor,
           jsonb_build_object('journey_reopened', true, 'mode', p_mode, 'subject_id', p_subject_id)
    FROM reopened
  ),
  restored_deals AS (
    UPDATE deals d
    SET stage_id = js.pipeline_stage_id,
        status = CASE js.stage_kind WHEN 'won' THEN 'won' WHEN 'lost' THEN 'lost' ELSE 'open' END
    FROM reopened r
    JOIN journey_stages js ON js.id = r.stage_id
    JOIN pipeline_stages ps ON ps.id = js.pipeline_stage_id
    WHERE d.source_journey_item_id = r.item_id
      AND d.account_id = p_account_id
      AND d.pipeline_id = ps.pipeline_id
      AND (d.stage_id IS DISTINCT FROM js.pipeline_stage_id
           OR d.status IS DISTINCT FROM
              CASE js.stage_kind WHEN 'won' THEN 'won' WHEN 'lost' THEN 'lost' ELSE 'open' END)
  )
  SELECT count(*) INTO v_count FROM reopened;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION journey_overview_state_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_was TEXT;
  v_actor UUID;
BEGIN
  v_was := CASE WHEN TG_OP = 'UPDATE' THEN OLD.lifecycle_status ELSE 'active' END;
  IF v_was IS NOT DISTINCT FROM NEW.lifecycle_status THEN
    RETURN NEW;
  END IF;
  v_actor := COALESCE(NEW.updated_by, NEW.created_by, auth.uid());

  IF NEW.lifecycle_status IN ('completed', 'not_proceeding') THEN
    PERFORM journey_close_branches(
      NEW.account_id,
      NEW.mode,
      NEW.subject_id,
      'Journey closed: ' || replace(NEW.lifecycle_status, '_', ' ')
        || COALESCE(' — ' || NULLIF(btrim(NEW.closure_reason), ''), ''),
      NEW.lifecycle_status = 'completed',
      v_actor
    );
  ELSIF NEW.lifecycle_status = 'active'
        AND v_was IN ('completed', 'not_proceeding') THEN
    PERFORM journey_reopen_branches(NEW.account_id, NEW.mode, NEW.subject_id, v_actor);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION journey_overview_state_sync() IS
  'Closing a journey as completed or not proceeding drops its live branches (keeping a won branch on completion) and marks their deals lost; reopening reactivates exactly the branches that close dropped and restores their deals. Paused and archived change nothing.';

DROP TRIGGER IF EXISTS journey_overview_state_sync_trigger ON journey_overview_states;
CREATE TRIGGER journey_overview_state_sync_trigger
  AFTER INSERT OR UPDATE OF lifecycle_status ON journey_overview_states
  FOR EACH ROW EXECUTE FUNCTION journey_overview_state_sync();

CREATE OR REPLACE FUNCTION journey_drop_on_deal_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage UUID;
BEGIN
  IF OLD.source_journey_item_id IS NULL THEN
    RETURN OLD;
  END IF;
  UPDATE journey_items
  SET status = 'dropped',
      drop_reason = 'Deal deleted',
      dropped_at = NOW(),
      planned_stage_id = NULL,
      planned_at = NULL
  WHERE id = OLD.source_journey_item_id
    AND account_id = OLD.account_id
    AND status = 'active'
  RETURNING stage_id INTO v_stage;
  IF v_stage IS NOT NULL THEN
    INSERT INTO journey_events (account_id, item_id, event_type, from_stage_id, to_stage_id, reason, created_by, metadata)
    VALUES (OLD.account_id, OLD.source_journey_item_id, 'dropped', v_stage, v_stage,
            'Deal deleted', auth.uid(),
            jsonb_build_object('deleted_deal', OLD.id, 'deal_title', OLD.title));
  END IF;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION journey_drop_on_deal_delete() IS
  'AFTER DELETE on deals: a linked live branch is dropped with the reason "Deal deleted" so the Journey stops offering a deal that no longer exists.';

DROP TRIGGER IF EXISTS journey_drop_on_deal_delete_trigger ON deals;
CREATE TRIGGER journey_drop_on_deal_delete_trigger
  AFTER DELETE ON deals
  FOR EACH ROW EXECUTE FUNCTION journey_drop_on_deal_delete();
