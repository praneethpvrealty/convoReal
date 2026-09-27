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
      AND EXISTS (
        SELECT 1
        FROM (
          SELECT e.metadata
          FROM journey_events e
          WHERE e.item_id = ji.id AND e.event_type = 'dropped'
          ORDER BY e.created_at DESC, e.id DESC
          LIMIT 1
        ) last_drop
        WHERE (last_drop.metadata ->> 'journey_closed') = 'true'
          AND (last_drop.metadata ->> 'mode') = p_mode
          AND (last_drop.metadata ->> 'subject_id') = p_subject_id::text
      )
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

-- Trigger-only: both helpers run as the definer and take a tenant id,
-- so no client role may call them over RPC.
REVOKE EXECUTE ON FUNCTION journey_close_branches(UUID, TEXT, UUID, TEXT, BOOLEAN, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION journey_reopen_branches(UUID, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

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

-- A branch that comes back to life — its deal moved off Lost on the
-- Board, or the branch reactivated on the Journey — reopens an
-- overview that was closed as completed or not proceeding; that reopen
-- restores the rest of what the close dropped through the trigger
-- above. Otherwise the Board and the branch would be open while the
-- Journey overview still hid them as closed.
CREATE OR REPLACE FUNCTION journey_reopen_overview_for_item(
  p_account_id UUID,
  p_item_id UUID,
  p_actor UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact UUID;
  v_property UUID;
BEGIN
  SELECT contact_id, property_id INTO v_contact, v_property
  FROM journey_items WHERE id = p_item_id AND account_id = p_account_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE journey_overview_states
  SET lifecycle_status = 'active',
      closure_reason = NULL,
      closed_at = NULL,
      updated_by = COALESCE(p_actor, updated_by)
  WHERE account_id = p_account_id
    AND lifecycle_status IN ('completed', 'not_proceeding')
    AND ((mode = 'buyer' AND subject_id = v_contact)
         OR (mode = 'property' AND subject_id = v_property));
END;
$$;

REVOKE EXECUTE ON FUNCTION journey_reopen_overview_for_item(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION sync_journey_item_stage_from_deal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_js UUID;
  v_from UUID;
  v_from_status TEXT;
  v_status TEXT;
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.source_journey_item_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT stage_id, status INTO v_from, v_from_status FROM journey_items
    WHERE id = NEW.source_journey_item_id AND account_id = NEW.account_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT id INTO v_js FROM journey_stages
    WHERE pipeline_stage_id = NEW.stage_id AND account_id = NEW.account_id;
  IF v_js IS NULL THEN
    v_js := v_from;
  END IF;
  v_status := CASE WHEN NEW.status = 'lost' THEN 'dropped' ELSE 'active' END;

  IF v_from IS DISTINCT FROM v_js OR v_from_status IS DISTINCT FROM v_status THEN
    UPDATE journey_items
      SET stage_id = v_js,
          status = v_status,
          drop_reason = CASE WHEN v_status = 'dropped'
                             THEN COALESCE(drop_reason, 'Deal marked lost')
                             ELSE NULL END,
          dropped_at = CASE WHEN v_status = 'dropped'
                            THEN COALESCE(dropped_at, NOW())
                            ELSE NULL END,
          planned_stage_id = NULL,
          planned_at = NULL
      WHERE id = NEW.source_journey_item_id AND account_id = NEW.account_id;
    INSERT INTO journey_events (account_id, item_id, event_type, from_stage_id, to_stage_id, created_by, metadata)
      VALUES (
        NEW.account_id,
        NEW.source_journey_item_id,
        CASE
          WHEN v_status = 'dropped' AND v_from_status IS DISTINCT FROM 'dropped' THEN 'dropped'
          WHEN v_status = 'active' AND v_from_status = 'dropped' THEN 'reactivated'
          ELSE 'moved'
        END,
        v_from,
        v_js,
        auth.uid(),
        jsonb_build_object('synced_from_deal', NEW.id, 'deal_status', NEW.status)
      );
    IF v_status = 'active' AND v_from_status = 'dropped' THEN
      PERFORM journey_reopen_overview_for_item(NEW.account_id, NEW.source_journey_item_id, auth.uid());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

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
  v_lost_ps UUID;
  v_status TEXT;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'active' AND OLD.status = 'dropped' THEN
    PERFORM journey_reopen_overview_for_item(NEW.account_id, NEW.id, auth.uid());
  END IF;
  SELECT js.pipeline_stage_id, js.stage_kind, ps.pipeline_id
    INTO v_ps, v_kind, v_pipeline
    FROM journey_stages js
    JOIN pipeline_stages ps ON ps.id = js.pipeline_stage_id
    WHERE js.id = NEW.stage_id;
  IF v_ps IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'dropped' THEN
    SELECT ps.id INTO v_lost_ps
      FROM pipeline_stages ps
      JOIN journey_stages js ON js.pipeline_stage_id = ps.id
      WHERE ps.pipeline_id = v_pipeline
        AND js.account_id = NEW.account_id
        AND js.stage_kind = 'lost'
      ORDER BY ps.position
      LIMIT 1;
    UPDATE deals
      SET stage_id = COALESCE(v_lost_ps, stage_id),
          status = 'lost'
      WHERE source_journey_item_id = NEW.id
        AND account_id = NEW.account_id
        AND pipeline_id = v_pipeline
        AND (status IS DISTINCT FROM 'lost'
             OR stage_id IS DISTINCT FROM COALESCE(v_lost_ps, stage_id));
    RETURN NEW;
  END IF;

  v_status := CASE v_kind WHEN 'won' THEN 'won' WHEN 'lost' THEN 'lost' ELSE 'open' END;
  UPDATE deals
    SET stage_id = v_ps,
        status = v_status
    WHERE source_journey_item_id = NEW.id
      AND account_id = NEW.account_id
      AND pipeline_id = v_pipeline
      AND (stage_id IS DISTINCT FROM v_ps OR status IS DISTINCT FROM v_status);
  RETURN NEW;
END;
$$;
