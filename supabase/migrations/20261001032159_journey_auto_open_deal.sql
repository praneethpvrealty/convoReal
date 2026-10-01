-- Every live journey branch is a deal on the Board.
--
-- A branch only reached the Board when someone pressed "Convert to
-- deal" or moved it into a closing stage, so the Board's early columns
-- sat empty while the Journey held the same buyers at the same stages.
-- Now a visible, active branch on a stage that mirrors a pipeline stage
-- opens its deal on that stage the moment it exists, is shown from the
-- Captured tray, is moved, or is reactivated. From then on the
-- deal ↔ branch triggers of …123000 keep the two in step.
--
--   journey_open_deal_for_item(item)   opens the deal, idempotent
--   journey_auto_open_deal             AFTER INSERT OR UPDATE ON journey_items
--
-- Not opened: a branch still hidden in the Captured tray, a dropped
-- branch, a branch on an unmirrored stage, and a branch already linked
-- to a deal. When the pair has an unlinked deal (the one left after the
-- linked deal was deleted), that deal is adopted, linked and moved to
-- the branch's stage instead of opening another. A deal that opens or is
-- adopted on a closing stage gets the standard milestone checklist and
-- syncs the listing status, as a Board move into that stage would. An UPDATE nested inside another trigger is
-- skipped, so dropping a branch because its deal was deleted never
-- reopens the deal; an INSERT at any depth is handled, because shares
-- capture branches from a trigger on property_shares.
--
-- A failure to open the deal is logged and never blocks the journey
-- write that caused it.
--
-- Held until merge: a trigger on a live table.

CREATE OR REPLACE FUNCTION journey_open_deal_for_item(p_item_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_stage RECORD;
  v_pair RECORD;
  v_user UUID;
  v_title TEXT;
  v_status TEXT;
  v_closing BOOLEAN;
  v_deal UUID;
  v_seeded INTEGER;
BEGIN
  SELECT ji.id, ji.account_id, ji.contact_id, ji.property_id, ji.stage_id,
         ji.status, ji.hidden, ji.created_by,
         c.name AS contact_name, c.phone AS contact_phone,
         p.title AS property_title, p.unit_no, p.price
    INTO v_item
    FROM journey_items ji
    LEFT JOIN contacts c ON c.id = ji.contact_id AND c.account_id = ji.account_id
    LEFT JOIN properties p ON p.id = ji.property_id AND p.account_id = ji.account_id
    WHERE ji.id = p_item_id;
  IF NOT FOUND OR v_item.hidden OR v_item.status <> 'active' THEN
    RETURN NULL;
  END IF;

  SELECT js.name AS journey_stage_name, js.stage_kind,
         ps.id AS pipeline_stage_id, ps.pipeline_id, ps.name, ps.stage_type
    INTO v_stage
    FROM journey_stages js
    JOIN pipeline_stages ps ON ps.id = js.pipeline_stage_id
    WHERE js.id = v_item.stage_id AND js.account_id = v_item.account_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM deals
    WHERE account_id = v_item.account_id AND source_journey_item_id = v_item.id
  ) THEN
    RETURN NULL;
  END IF;

  v_status := CASE
    WHEN v_stage.stage_type = 'lost' THEN 'lost'
    WHEN v_stage.stage_type IN ('won', 'brokerage_pending', 'brokerage_paid') THEN 'won'
    ELSE 'open'
  END;
  v_closing := v_stage.stage_type IN ('committed', 'won', 'brokerage_pending', 'brokerage_paid');

  SELECT id, pipeline_id INTO v_pair
    FROM deals
    WHERE account_id = v_item.account_id
      AND contact_id = v_item.contact_id
      AND property_id = v_item.property_id
      AND source_journey_item_id IS NULL
    ORDER BY created_at, id
    LIMIT 1;

  BEGIN
    IF v_pair.id IS NOT NULL THEN
      -- The pair already has a deal no branch holds: link it and bring it
      -- to the branch's stage rather than opening a second one.
      UPDATE deals SET source_journey_item_id = v_item.id
        WHERE id = v_pair.id AND account_id = v_item.account_id;
      IF v_pair.pipeline_id = v_stage.pipeline_id THEN
        UPDATE deals
          SET stage_id = v_stage.pipeline_stage_id,
              status = v_status
          WHERE id = v_pair.id AND account_id = v_item.account_id
            AND (stage_id IS DISTINCT FROM v_stage.pipeline_stage_id
                 OR status IS DISTINCT FROM v_status);
      ELSE
        v_closing := FALSE;
      END IF;
      v_deal := v_pair.id;
    ELSE
      v_user := COALESCE(
        v_item.created_by,
        auth.uid(),
        (SELECT owner_user_id FROM accounts WHERE id = v_item.account_id)
      );
      IF v_user IS NULL THEN
        RETURN NULL;
      END IF;

      v_title := LEFT(
        COALESCE(NULLIF(BTRIM(v_item.contact_name), ''), NULLIF(BTRIM(v_item.contact_phone), ''), 'Buyer')
        || ' — '
        || COALESCE(
             'Property No. ' || NULLIF(BTRIM(v_item.unit_no), ''),
             NULLIF(BTRIM(v_item.property_title), ''),
             'Property'
           ),
        200
      );

      INSERT INTO deals (
        account_id, user_id, pipeline_id, stage_id, contact_id, property_id,
        title, value, currency, status, source_journey_item_id
      )
      VALUES (
        v_item.account_id, v_user, v_stage.pipeline_id, v_stage.pipeline_stage_id,
        v_item.contact_id, v_item.property_id,
        v_title, COALESCE(v_item.price, 0), 'INR', v_status, v_item.id
      )
      RETURNING id INTO v_deal;

      INSERT INTO deal_events (
        account_id, deal_id, event_type, source, actor_id, title, metadata, dedupe_key
      )
      VALUES (
        v_item.account_id, v_deal, 'converted_from_journey', 'system', auth.uid(),
        'Opened from journey at ' || v_stage.journey_stage_name,
        jsonb_build_object(
          'journey_item_id', v_item.id,
          'journey_stage_id', v_item.stage_id,
          'journey_stage_name', v_stage.journey_stage_name,
          'journey_stage_kind', v_stage.stage_kind,
          'contact_id', v_item.contact_id,
          'property_id', v_item.property_id,
          'pipeline_id', v_stage.pipeline_id,
          'stage_id', v_stage.pipeline_stage_id,
          'stage_name', v_stage.name,
          'automatic', true
        ),
        'convert:' || v_item.id
      );

      INSERT INTO journey_events (
        account_id, item_id, event_type, created_by, metadata, dedupe_key
      )
      VALUES (
        v_item.account_id, v_item.id, 'converted_to_deal', auth.uid(),
        jsonb_build_object('deal_id', v_deal, 'deal_title', v_title, 'automatic', true),
        'deal:' || v_deal
      );
    END IF;

    IF v_closing THEN
      -- The closing checklist a Board move into this stage would seed
      -- (DEAL_MILESTONE_TEMPLATES in src/lib/deals/milestones.ts).
      IF NOT EXISTS (
        SELECT 1 FROM deal_milestones
        WHERE deal_id = v_deal AND account_id = v_item.account_id
      ) THEN
        INSERT INTO deal_milestones (account_id, deal_id, template_key, title, position)
        SELECT v_item.account_id, v_deal, t.key, t.title, t.ord - 1
        FROM unnest(
          ARRAY[
            'initial_negotiation', 'commercial_terms_agreed', 'token_paid',
            'documents_collected', 'legal_verification', 'loan_processing',
            'draft_agreement_shared', 'agreement_executed', 'conditions_precedent',
            'tds_and_instruments', 'registration_scheduled', 'sale_deed_registered',
            'possession_handover', 'brokerage_collected', 'deal_closed'
          ],
          ARRAY[
            'Initial negotiation', 'Commercial terms agreed', 'Token paid',
            'Documents collected', 'Legal verification', 'Loan processing / sanction',
            'Draft agreement shared', 'Agreement executed', 'Conditions precedent completed',
            'TDS and payment instruments prepared', 'Registration scheduled', 'Sale deed registered',
            'Possession / handover', 'Brokerage collected', 'Deal closed'
          ]
        ) WITH ORDINALITY AS t(key, title, ord);
        GET DIAGNOSTICS v_seeded = ROW_COUNT;
        INSERT INTO deal_events (
          account_id, deal_id, event_type, source, actor_id, title, metadata
        )
        VALUES (
          v_item.account_id, v_deal, 'milestone_added', 'system', auth.uid(),
          'Added ' || v_seeded || ' standard milestones on reaching ' || v_stage.name,
          jsonb_build_object('template', 'standard', 'count', v_seeded, 'stage', v_stage.name)
        );
      END IF;

      BEGIN
        PERFORM sync_listing_status_from_deals(
          v_item.account_id,
          v_item.property_id,
          CASE WHEN v_status = 'won' THEN 'Sold' ELSE 'Under Contract' END
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'journey_open_deal_for_item(%): listing status not synced: %', p_item_id, SQLERRM;
      END;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'journey_open_deal_for_item(%): %', p_item_id, SQLERRM;
    RETURN NULL;
  END;

  RETURN v_deal;
END;
$$;

COMMENT ON FUNCTION journey_open_deal_for_item(UUID) IS
  'Opens (or adopts the pair''s unlinked) Board deal for a visible, active journey branch on a mirrored stage that has no linked deal, seeding the closing checklist on a closing stage. Idempotent; returns the deal id or NULL.';

REVOKE ALL ON FUNCTION journey_open_deal_for_item(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION journey_auto_open_deal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  PERFORM journey_open_deal_for_item(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS journey_auto_open_deal_trigger ON journey_items;
CREATE TRIGGER journey_auto_open_deal_trigger
  AFTER INSERT OR UPDATE OF hidden, stage_id, status ON journey_items
  FOR EACH ROW
  WHEN (NOT NEW.hidden AND NEW.status = 'active')
  EXECUTE FUNCTION journey_auto_open_deal();
