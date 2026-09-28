-- ============================================================
-- Read stage meaning from stage_type, and move every account on the
-- standard real-estate pipeline to the new stage sequence.
--
-- Each new stage name reads as the step just completed → the step it
-- activates. Negotiation now happens in and after the owner's meeting,
-- so a deal only puts its listing Under Contract once it is confirmed:
--
--   Enquiry → Shortlist                  open
--   Shortlisted → Visit                  open
--   Finalised → Owner's meeting          open
--   Owner's meeting → Negotiation        open
--   Deal confirmed → Due diligence       committed
--   Legal done → Agreement/Registration  committed
--   Registered → Brokerage               brokerage_pending
--   Brokerage paid / Closed              brokerage_paid
--   Closed Lost                          lost
--
-- Not additive: it replaces live functions (listing status, the
-- journey mirror, brokerage-paid stamping, the default pipeline seed,
-- the deal ↔ journey lost sync) and rewrites stage rows, so it is
-- applied only once the pull request that carries it is merged.
--
-- Pipelines still on the old standard nine stages are updated in place,
-- keeping every stage id, so deals, journey mirrors and history stay
-- attached. Deals on "Negotiation/Token" land on "Owner's meeting →
-- Negotiation"; deals on "Deal Closed/Won" move to "Registered →
-- Brokerage" so a won deal stays won. Pipelines with any other stage
-- list are left as they are.
-- ============================================================

CREATE OR REPLACE FUNCTION journey_stages_mirror_pipeline(p_account_id uuid, p_pipeline_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ps RECORD;
BEGIN
  FOR ps IN
    SELECT id, name, color, position, stage_type
      FROM pipeline_stages
      WHERE pipeline_id = p_pipeline_id
      ORDER BY position
  LOOP
    UPDATE journey_stages
      SET name = ps.name,
          color = COALESCE(ps.color, color),
          position = ps.position,
          stage_kind = journey_stage_kind_for_stage_type(ps.stage_type)
      WHERE account_id = p_account_id AND pipeline_stage_id = ps.id;
    IF NOT FOUND THEN
      INSERT INTO journey_stages (account_id, name, color, position, stage_kind, pipeline_stage_id)
        VALUES (
          p_account_id,
          ps.name,
          COALESCE(ps.color, '#3b82f6'),
          ps.position,
          journey_stage_kind_for_stage_type(ps.stage_type),
          ps.id
        );
    END IF;
  END LOOP;
  UPDATE journey_stages
    SET position = position + 1000
    WHERE account_id = p_account_id AND pipeline_stage_id IS NULL AND position < 1000;
END;
$$;

CREATE OR REPLACE FUNCTION sync_listing_status_from_deals(p_account_id uuid, p_property_id uuid, p_requested text)
RETURNS TABLE(previous_status text, new_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_previous TEXT;
  v_held INTEGER;
  v_target TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'not an agent on this account' USING ERRCODE = '42501';
  END IF;
  IF p_requested NOT IN ('Available', 'Under Contract', 'Sold') THEN
    RAISE EXCEPTION 'unsupported listing status %', p_requested
      USING ERRCODE = '22023';
  END IF;

  SELECT status INTO v_previous
  FROM properties
  WHERE id = p_property_id AND account_id = p_account_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(MAX(
    CASE
      WHEN d.status = 'won' THEN 2
      WHEN s.stage_type = 'lost' THEN 0
      WHEN s.stage_type IN ('won', 'brokerage_pending', 'brokerage_paid') THEN 2
      WHEN s.stage_type = 'committed' THEN 1
      ELSE 0
    END
  ), 0)
  INTO v_held
  FROM deals d
  LEFT JOIN pipeline_stages s ON s.id = d.stage_id
  WHERE d.account_id = p_account_id
    AND d.property_id = p_property_id
    AND d.status IN ('open', 'won');

  v_target := CASE v_held
    WHEN 2 THEN 'Sold'
    WHEN 1 THEN 'Under Contract'
    ELSE 'Available'
  END;

  UPDATE properties
  SET status = v_target
  WHERE id = p_property_id AND account_id = p_account_id;

  RETURN QUERY SELECT v_previous, v_target;
END;
$$;

CREATE OR REPLACE FUNCTION sync_deal_brokerage_paid_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  target_stage_type TEXT;
BEGIN
  SELECT stage_type
  INTO target_stage_type
  FROM pipeline_stages
  WHERE id = NEW.stage_id;

  IF target_stage_type = 'brokerage_paid' THEN
    NEW.brokerage_paid_at = COALESCE(NEW.brokerage_paid_at, NOW());
  ELSIF TG_OP = 'UPDATE' AND NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    NEW.brokerage_paid_at = NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ensure_default_pipeline(p_account_id uuid)
RETURNS uuid
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
  -- Mirrors SPEC_DEFAULT_STAGES in src/lib/pipelines/default-stages.ts.
  IF NOT EXISTS (SELECT 1 FROM pipeline_stages WHERE pipeline_id = v_id) THEN
    INSERT INTO pipeline_stages (pipeline_id, name, color, position, stage_type) VALUES
      (v_id, 'Enquiry → Shortlist', '#3b82f6', 0, 'open'),
      (v_id, 'Shortlisted → Visit', '#eab308', 1, 'open'),
      (v_id, 'Finalised → Owner''s meeting', '#f97316', 2, 'open'),
      (v_id, 'Owner''s meeting → Negotiation', '#8b5cf6', 3, 'open'),
      (v_id, 'Deal confirmed → Due diligence', '#06b6d4', 4, 'committed'),
      (v_id, 'Legal done → Agreement/Registration', '#14b8a6', 5, 'committed'),
      (v_id, 'Registered → Brokerage', '#f59e0b', 6, 'brokerage_pending'),
      (v_id, 'Brokerage paid / Closed', '#16a34a', 7, 'brokerage_paid'),
      (v_id, 'Closed Lost', '#ef4444', 8, 'lost');
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION sync_journey_item_stage_from_deal()
RETURNS trigger
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
                             THEN COALESCE(
                               drop_reason,
                               NULLIF(concat_ws(': ', NEW.lost_reason, NULLIF(btrim(NEW.lost_note), '')), ''),
                               'Deal marked lost'
                             )
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
RETURNS trigger
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
          status = 'lost',
          lost_reason = COALESCE(lost_reason, NULLIF(btrim(NEW.drop_reason), ''))
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

DO $$
DECLARE
  v_old TEXT[] := ARRAY[
    'New Inquiry', 'Profiling/Qualified', 'Site Visit Scheduled',
    'Negotiation/Token', 'Due Diligence/Contract', 'Deal Closed/Won',
    'Brokerage Pending', 'Brokerage Paid', 'Closed Lost'
  ];
  v_new TEXT[] := ARRAY[
    'Enquiry → Shortlist', 'Shortlisted → Visit', 'Finalised → Owner''s meeting',
    'Owner''s meeting → Negotiation', 'Deal confirmed → Due diligence',
    'Legal done → Agreement/Registration', 'Registered → Brokerage',
    'Brokerage paid / Closed', 'Closed Lost'
  ];
  v_type TEXT[] := ARRAY[
    'open', 'open', 'open', 'open', 'committed', 'committed',
    'brokerage_pending', 'brokerage_paid', 'lost'
  ];
  v_color TEXT[] := ARRAY[
    '#3b82f6', '#eab308', '#f97316', '#8b5cf6', '#06b6d4', '#14b8a6',
    '#f59e0b', '#16a34a', '#ef4444'
  ];
  p RECORD;
  v_stage_ids UUID[];
  v_prop RECORD;
  i INTEGER;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  FOR p IN
    SELECT pl.id, pl.account_id
      FROM pipelines pl
      WHERE (
        SELECT array_agg(s.name ORDER BY s.position)
          FROM pipeline_stages s
          WHERE s.pipeline_id = pl.id
      ) = v_old
  LOOP
    SELECT array_agg(s.id ORDER BY s.position)
      INTO v_stage_ids
      FROM pipeline_stages s
      WHERE s.pipeline_id = p.id;

    UPDATE deals
      SET stage_id = v_stage_ids[7]
      WHERE pipeline_id = p.id AND stage_id = v_stage_ids[6];

    FOR i IN 1..9 LOOP
      UPDATE pipeline_stages
        SET name = v_new[i],
            stage_type = v_type[i],
            color = v_color[i],
            position = i - 1
        WHERE id = v_stage_ids[i];
    END LOOP;

    IF p.id = (
      SELECT id FROM pipelines
        WHERE account_id = p.account_id
        ORDER BY created_at
        LIMIT 1
    ) THEN
      PERFORM journey_stages_mirror_pipeline(p.account_id, p.id);
    END IF;

    FOR v_prop IN
      SELECT DISTINCT d.property_id
        FROM deals d
        WHERE d.pipeline_id = p.id
          AND d.account_id = p.account_id
          AND d.property_id IS NOT NULL
          AND d.status IN ('open', 'won')
    LOOP
      PERFORM sync_listing_status_from_deals(p.account_id, v_prop.property_id, 'Available');
    END LOOP;
  END LOOP;
END;
$$;
