-- Journey, Board, Records and Dashboard read two tables: journey_items
-- and deals. What held them together was a pair of triggers that fired
-- on stage_id alone, and nothing on INSERT — so a deal created on the
-- Board never reached the journey (7 of the reporting account's 9
-- deals), a journey drop left its deal open on the Board, the
-- Dashboard's open-deal count and the Records index, and a deal marked
-- lost left its branch live.
--
-- Three functions now hold the invariant: a deal with a contact and a
-- property is linked to that pair's journey branch, and stage and
-- status mirror both ways on the default pipeline
-- (open ↔ active, won ↔ active on a won stage, lost ↔ dropped).
--
--   journey_link_deal              AFTER INSERT ON deals
--   sync_journey_item_stage_from_deal  AFTER UPDATE OF stage_id, status ON deals
--   sync_deal_stage_from_journey_item  AFTER UPDATE OF stage_id, status ON journey_items
--
-- Every function returns early at trigger depth > 1, so a change on one
-- side syncs the other exactly once and never bounces back.
--
-- Held until merge: CREATE OR REPLACE of live functions and a trigger
-- on a live table. The backfill (…123100) relies on it.

-- ---------------------------------------------------------------------
-- Deal → journey item: stage and status.
-- ---------------------------------------------------------------------
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
  -- A deal on a pipeline the journey does not mirror keeps the branch
  -- where it is; only its outcome is carried over.
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
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- Journey item → deal: stage and status.
-- ---------------------------------------------------------------------
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
  SELECT js.pipeline_stage_id, js.stage_kind, ps.pipeline_id
    INTO v_ps, v_kind, v_pipeline
    FROM journey_stages js
    JOIN pipeline_stages ps ON ps.id = js.pipeline_stage_id
    WHERE js.id = NEW.stage_id;
  IF v_ps IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'dropped' THEN
    -- A dropped branch is a lost deal; the card goes to the board's
    -- lost stage when it has one, and stays put otherwise.
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

-- ---------------------------------------------------------------------
-- New deal → journey item: link, create when missing, align.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION journey_link_deal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_js UUID;
  v_first UUID;
  v_item UUID;
  v_item_stage UUID;
  v_item_status TEXT;
  v_status TEXT;
  v_taken BOOLEAN;
BEGIN
  IF pg_trigger_depth() > 1
     OR NEW.contact_id IS NULL
     OR NEW.property_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_js FROM journey_stages
    WHERE pipeline_stage_id = NEW.stage_id AND account_id = NEW.account_id;
  SELECT id INTO v_first FROM journey_stages
    WHERE account_id = NEW.account_id AND pipeline_stage_id IS NOT NULL
    ORDER BY position, id
    LIMIT 1;
  IF v_first IS NULL THEN
    PERFORM journey_stages_for_account(NEW.account_id);
    SELECT id INTO v_js FROM journey_stages
      WHERE pipeline_stage_id = NEW.stage_id AND account_id = NEW.account_id;
    SELECT id INTO v_first FROM journey_stages
      WHERE account_id = NEW.account_id AND pipeline_stage_id IS NOT NULL
      ORDER BY position, id
      LIMIT 1;
  END IF;
  IF v_first IS NULL THEN
    RETURN NEW;
  END IF;
  v_status := CASE WHEN NEW.status = 'lost' THEN 'dropped' ELSE 'active' END;

  IF NEW.source_journey_item_id IS NOT NULL THEN
    -- A conversion chose its stage from the branch already; only the
    -- outcome and the tray are aligned here.
    v_item := NEW.source_journey_item_id;
    v_js := NULL;
  ELSE
    SELECT id INTO v_item FROM journey_items
      WHERE account_id = NEW.account_id
        AND contact_id = NEW.contact_id
        AND property_id = NEW.property_id;
    IF v_item IS NULL THEN
      INSERT INTO journey_items (
        account_id, contact_id, property_id, stage_id, source, hidden,
        status, drop_reason, dropped_at, created_by
      )
      VALUES (
        NEW.account_id, NEW.contact_id, NEW.property_id,
        COALESCE(v_js, v_first), 'manual', FALSE,
        v_status,
        CASE WHEN v_status = 'dropped' THEN 'Deal marked lost' END,
        CASE WHEN v_status = 'dropped' THEN NOW() END,
        NEW.user_id
      )
      ON CONFLICT (account_id, contact_id, property_id) DO NOTHING
      RETURNING id INTO v_item;
      IF v_item IS NOT NULL THEN
        INSERT INTO journey_events (account_id, item_id, event_type, to_stage_id, reason, created_by, metadata)
          VALUES (
            NEW.account_id, v_item, 'added', COALESCE(v_js, v_first),
            'Captured from deal', NEW.user_id,
            jsonb_build_object('synced_from_deal', NEW.id)
          );
      ELSE
        SELECT id INTO v_item FROM journey_items
          WHERE account_id = NEW.account_id
            AND contact_id = NEW.contact_id
            AND property_id = NEW.property_id;
      END IF;
    END IF;
    IF v_item IS NULL THEN
      RETURN NEW;
    END IF;
    -- One deal per branch: a second deal for the same pair stays
    -- unlinked rather than stealing the link.
    SELECT EXISTS (
      SELECT 1 FROM deals
      WHERE source_journey_item_id = v_item AND id <> NEW.id
    ) INTO v_taken;
    IF v_taken THEN
      RETURN NEW;
    END IF;
    UPDATE deals SET source_journey_item_id = v_item WHERE id = NEW.id;
  END IF;

  -- The branch takes the deal's stage and outcome. A deal on a pipeline
  -- the journey does not mirror only carries its outcome over.
  SELECT stage_id, status INTO v_item_stage, v_item_status
    FROM journey_items WHERE id = v_item AND account_id = NEW.account_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF v_js IS NULL THEN
    v_js := v_item_stage;
  END IF;
  IF v_item_stage IS DISTINCT FROM v_js OR v_item_status IS DISTINCT FROM v_status THEN
    UPDATE journey_items
      SET stage_id = v_js,
          status = v_status,
          hidden = FALSE,
          drop_reason = CASE WHEN v_status = 'dropped'
                             THEN COALESCE(drop_reason, 'Deal marked lost')
                             ELSE NULL END,
          dropped_at = CASE WHEN v_status = 'dropped'
                            THEN COALESCE(dropped_at, NOW())
                            ELSE NULL END,
          planned_stage_id = NULL,
          planned_at = NULL
      WHERE id = v_item AND account_id = NEW.account_id;
    INSERT INTO journey_events (account_id, item_id, event_type, from_stage_id, to_stage_id, created_by, metadata)
      VALUES (
        NEW.account_id, v_item,
        CASE
          WHEN v_status = 'dropped' AND v_item_status IS DISTINCT FROM 'dropped' THEN 'dropped'
          WHEN v_status = 'active' AND v_item_status = 'dropped' THEN 'reactivated'
          ELSE 'moved'
        END,
        v_item_stage, v_js, NEW.user_id,
        jsonb_build_object('synced_from_deal', NEW.id, 'deal_status', NEW.status)
      );
  ELSIF EXISTS (SELECT 1 FROM journey_items WHERE id = v_item AND hidden) THEN
    -- A deal is a decision to track the pair: it leaves the Captured tray.
    UPDATE journey_items SET hidden = FALSE WHERE id = v_item;
    INSERT INTO journey_events (account_id, item_id, event_type, from_stage_id, to_stage_id, created_by, metadata)
      VALUES (NEW.account_id, v_item, 'unhidden', v_item_stage, v_item_stage, NEW.user_id,
              jsonb_build_object('synced_from_deal', NEW.id));
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION journey_link_deal() IS
  'AFTER INSERT on deals: links a deal with a contact and a property to that pair''s journey branch (creating it at the deal''s mirrored stage when missing), and aligns the branch''s stage and status to the deal. A second deal for the same pair stays unlinked.';

DROP TRIGGER IF EXISTS sync_journey_item_stage_from_deal_trigger ON deals;
CREATE TRIGGER sync_journey_item_stage_from_deal_trigger
  AFTER UPDATE OF stage_id, status ON deals
  FOR EACH ROW
  WHEN (OLD.stage_id IS DISTINCT FROM NEW.stage_id OR OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION sync_journey_item_stage_from_deal();

DROP TRIGGER IF EXISTS sync_deal_stage_from_journey_item_trigger ON journey_items;
CREATE TRIGGER sync_deal_stage_from_journey_item_trigger
  AFTER UPDATE OF stage_id, status ON journey_items
  FOR EACH ROW
  WHEN (OLD.stage_id IS DISTINCT FROM NEW.stage_id OR OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION sync_deal_stage_from_journey_item();

DROP TRIGGER IF EXISTS journey_link_deal_trigger ON deals;
CREATE TRIGGER journey_link_deal_trigger
  AFTER INSERT ON deals
  FOR EACH ROW EXECUTE FUNCTION journey_link_deal();
