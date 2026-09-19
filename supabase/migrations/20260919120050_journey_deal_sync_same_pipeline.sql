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
-- Sync RPC: only the account's default pipeline mirrors to the
-- journey. A supplied pipeline that is not the default is refused
-- rather than mirrored alongside it.
--
-- Default pipeline: resolved under a per-account transaction lock, so
-- two first-time syncs cannot each create a board, and a default
-- board with no stages is given the standard stages so the journey
-- always has a rail.
--
-- Held until merge: CREATE OR REPLACE of live functions.
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

CREATE OR REPLACE FUNCTION sync_journey_stages_from_pipeline(
  p_account_id UUID,
  p_pipeline_id UUID DEFAULT NULL
)
RETURNS SETOF journey_stages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline UUID;
BEGIN
  IF NOT is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'not an agent on this account' USING ERRCODE = '42501';
  END IF;
  v_pipeline := ensure_default_pipeline(p_account_id);
  IF v_pipeline IS NULL THEN
    RAISE EXCEPTION 'no pipeline for this account' USING ERRCODE = '42501';
  END IF;
  IF p_pipeline_id IS NOT NULL AND p_pipeline_id <> v_pipeline THEN
    RAISE EXCEPTION 'only the default pipeline mirrors to the journey' USING ERRCODE = '22023';
  END IF;
  PERFORM journey_stages_mirror_pipeline(p_account_id, v_pipeline);
  RETURN QUERY
    SELECT * FROM journey_stages
      WHERE account_id = p_account_id AND pipeline_stage_id IS NOT NULL
      ORDER BY position;
END;
$$;

CREATE OR REPLACE FUNCTION ensure_default_pipeline(p_account_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_user UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ensure_default_pipeline'), hashtext(p_account_id::text));
  SELECT id INTO v_id FROM pipelines
    WHERE account_id = p_account_id
    ORDER BY created_at
    LIMIT 1;
  IF v_id IS NULL THEN
    v_user := COALESCE(auth.uid(), (SELECT owner_user_id FROM accounts WHERE id = p_account_id));
    IF v_user IS NULL THEN
      RETURN NULL;
    END IF;
    INSERT INTO pipelines (user_id, account_id, name)
      VALUES (v_user, p_account_id, 'Real Estate Pipeline')
      RETURNING id INTO v_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pipeline_stages WHERE pipeline_id = v_id) THEN
    INSERT INTO pipeline_stages (pipeline_id, name, color, position) VALUES
      (v_id, 'New Inquiry', '#3b82f6', 0),
      (v_id, 'Profiling/Qualified', '#eab308', 1),
      (v_id, 'Site Visit Scheduled', '#f97316', 2),
      (v_id, 'Negotiation/Token', '#8b5cf6', 3),
      (v_id, 'Due Diligence/Contract', '#06b6d4', 4),
      (v_id, 'Deal Closed/Won', '#22c55e', 5),
      (v_id, 'Brokerage Pending', '#f59e0b', 6),
      (v_id, 'Brokerage Paid', '#16a34a', 7),
      (v_id, 'Closed Lost', '#ef4444', 8);
  END IF;
  RETURN v_id;
END;
$$;
