-- ============================================================
-- Journey stages mirror the account's default pipeline.
--
-- Journey and Pipelines each had their own stage vocabulary for the
-- same buyer × property row. journey_stages now carries
-- pipeline_stage_id, the mirror function keeps one journey stage per
-- pipeline stage (name, colour, order and kind), and two triggers keep
-- a converted deal and its journey item on the same stage whichever
-- side moved.
--
-- Additive: a new column, new functions and new triggers. Nothing
-- changes for an account until the sync function runs for it, which
-- only the new app code (or the held backfill) does.
-- ============================================================

ALTER TABLE journey_stages
  ADD COLUMN IF NOT EXISTS pipeline_stage_id UUID
    REFERENCES pipeline_stages(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_journey_stages_pipeline_stage
  ON journey_stages (pipeline_stage_id)
  WHERE pipeline_stage_id IS NOT NULL;

-- Mirrors journeyStageKindForPipelineStage in
-- src/lib/pipelines/stage-semantics.ts; the parity test reads this file.
CREATE OR REPLACE FUNCTION journey_stage_kind_for_pipeline_stage(stage_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN n LIKE '%lost%' THEN 'lost'
    WHEN n LIKE '%won%' OR n LIKE '%registered%' OR n LIKE '%brokerage%' THEN 'won'
    WHEN n LIKE '%negotiation%' OR n LIKE '%token%'
      OR n LIKE '%due diligence%' OR n LIKE '%contract%' THEN 'closing'
    ELSE 'prospecting'
  END
  FROM (SELECT lower(btrim(stage_name)) AS n) s;
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
  SELECT id INTO v_id FROM pipelines
    WHERE account_id = p_account_id
    ORDER BY created_at
    LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  v_user := COALESCE(auth.uid(), (SELECT owner_user_id FROM accounts WHERE id = p_account_id));
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO pipelines (user_id, account_id, name)
    VALUES (v_user, p_account_id, 'Real Estate Pipeline')
    RETURNING id INTO v_id;
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
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION ensure_default_pipeline(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ensure_default_pipeline(UUID) TO service_role;

CREATE OR REPLACE FUNCTION journey_stages_mirror_pipeline(p_account_id UUID, p_pipeline_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ps RECORD;
BEGIN
  FOR ps IN
    SELECT id, name, color, position
      FROM pipeline_stages
      WHERE pipeline_id = p_pipeline_id
      ORDER BY position
  LOOP
    UPDATE journey_stages
      SET name = ps.name,
          color = COALESCE(ps.color, color),
          position = ps.position,
          stage_kind = journey_stage_kind_for_pipeline_stage(ps.name)
      WHERE account_id = p_account_id AND pipeline_stage_id = ps.id;
    IF NOT FOUND THEN
      INSERT INTO journey_stages (account_id, name, color, position, stage_kind, pipeline_stage_id)
        VALUES (
          p_account_id,
          ps.name,
          COALESCE(ps.color, '#3b82f6'),
          ps.position,
          journey_stage_kind_for_pipeline_stage(ps.name),
          ps.id
        );
    END IF;
  END LOOP;
  UPDATE journey_stages
    SET position = position + 1000
    WHERE account_id = p_account_id AND pipeline_stage_id IS NULL AND position < 1000;
END;
$$;

REVOKE ALL ON FUNCTION journey_stages_mirror_pipeline(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION journey_stages_mirror_pipeline(UUID, UUID) TO service_role;

-- Signed-in staff: mirror the account's default pipeline (creating the
-- default board when the account has none) and return the mirrored
-- stages in order. Guarded by membership like every account function.
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
  v_pipeline := COALESCE(p_pipeline_id, ensure_default_pipeline(p_account_id));
  IF v_pipeline IS NULL
     OR NOT EXISTS (SELECT 1 FROM pipelines WHERE id = v_pipeline AND account_id = p_account_id) THEN
    RAISE EXCEPTION 'pipeline does not belong to this account' USING ERRCODE = '42501';
  END IF;
  PERFORM journey_stages_mirror_pipeline(p_account_id, v_pipeline);
  RETURN QUERY
    SELECT * FROM journey_stages
      WHERE account_id = p_account_id AND pipeline_stage_id IS NOT NULL
      ORDER BY position;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_journey_stages_from_pipeline(UUID, UUID) TO authenticated, service_role;

-- Server code (webhooks, digests) runs as the service role with no
-- auth.uid(): the same mirror, unguarded, for that role only.
CREATE OR REPLACE FUNCTION journey_stages_for_account(p_account_id UUID)
RETURNS SETOF journey_stages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline UUID;
BEGIN
  v_pipeline := ensure_default_pipeline(p_account_id);
  IF v_pipeline IS NOT NULL THEN
    PERFORM journey_stages_mirror_pipeline(p_account_id, v_pipeline);
  END IF;
  RETURN QUERY
    SELECT * FROM journey_stages
      WHERE account_id = p_account_id AND pipeline_stage_id IS NOT NULL
      ORDER BY position;
END;
$$;

REVOKE ALL ON FUNCTION journey_stages_for_account(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION journey_stages_for_account(UUID) TO service_role;

-- A journey item moved onto a mirrored stage moves its converted deal.
CREATE OR REPLACE FUNCTION sync_deal_stage_from_journey_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ps UUID;
  v_kind TEXT;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  SELECT pipeline_stage_id, stage_kind INTO v_ps, v_kind
    FROM journey_stages WHERE id = NEW.stage_id;
  IF v_ps IS NULL THEN
    RETURN NEW;
  END IF;
  UPDATE deals
    SET stage_id = v_ps,
        status = CASE v_kind WHEN 'won' THEN 'won' WHEN 'lost' THEN 'lost' ELSE 'open' END
    WHERE source_journey_item_id = NEW.id
      AND account_id = NEW.account_id
      AND stage_id IS DISTINCT FROM v_ps;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_deal_stage_from_journey_item_trigger ON journey_items;
CREATE TRIGGER sync_deal_stage_from_journey_item_trigger
  AFTER UPDATE OF stage_id ON journey_items
  FOR EACH ROW
  WHEN (OLD.stage_id IS DISTINCT FROM NEW.stage_id)
  EXECUTE FUNCTION sync_deal_stage_from_journey_item();

-- A converted deal moved on the board moves its journey item, and the
-- journey keeps the move in its own history.
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
  SELECT stage_id INTO v_from FROM journey_items WHERE id = NEW.source_journey_item_id;
  IF v_from IS DISTINCT FROM v_js THEN
    UPDATE journey_items
      SET stage_id = v_js,
          status = 'active',
          drop_reason = NULL,
          dropped_at = NULL,
          planned_stage_id = NULL,
          planned_at = NULL
      WHERE id = NEW.source_journey_item_id;
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

DROP TRIGGER IF EXISTS sync_journey_item_stage_from_deal_trigger ON deals;
CREATE TRIGGER sync_journey_item_stage_from_deal_trigger
  AFTER UPDATE OF stage_id ON deals
  FOR EACH ROW
  WHEN (OLD.stage_id IS DISTINCT FROM NEW.stage_id)
  EXECUTE FUNCTION sync_journey_item_stage_from_deal();
