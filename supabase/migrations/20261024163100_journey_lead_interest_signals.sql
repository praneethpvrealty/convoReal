-- ============================================================
-- 20261024163100_journey_lead_interest_signals.sql
--
-- Reads and backfills the lead_interest stamp that
-- 20261024163000_journey_lead_interest.sql added to journey_items.
--
-- 1. Backfill. Every Interested answer already on listing_feedback (the
--    Interested tap, a typed WhatsApp enquiry, a portal enquiry, a
--    showcase check-in visit or call: the same writers that stamp the
--    journey live from now on; a later rejection overwrote the verdict,
--    so a lead who then said no is left out) and every WhatsApp
--    Shortlist tap already on property_likes (the session_key
--    'wa:<contact>' rows the bot writes, unless the lead themselves said
--    no to that listing after the tap, as the live clear does; a showcase
--    like is a like, not a shortlist, and the Helper already counts it)
--    stamps its journey item. A pair never captured is captured hidden
--    at the account's first mirrored stage, as the share backfill did
--    (20260926115400), labelled an enquiry when an enquiry is on file
--    for the pair and a WhatsApp share otherwise (as the live writers
--    do), so it waits in the Captured tray rather than appearing on the
--    map unreviewed; a pair the ledger holds a share for is skipped,
--    since the share capture put it on the journey and its absence
--    means the agent removed it from the tray; Interested outranks
--    Shortlisted.
--
-- 2. journey_overview_groups adds interested_count per journey so both
--    surfaces can show the chip on the overview row.
--
-- 3. journey_capture_from_share shows a pair that only a lead's yes
--    captured hidden and nobody reviewed since when a visible ledger row
--    (an agent-composed share, JRN-009) arrives for it, as the
--    TypeScript capture does, and opens the branch's deal itself since
--    journey_auto_open_deal sits out an UPDATE made from inside another
--    trigger (JRN-018); a pair a share captured, or one the agent
--    showed and hid again, still stays hidden.
--
-- The stamp records what the lead said, not activity on the item: the
-- overview's last_updated, the closing-nudge stall clock and the
-- Helper's signal time all read updated_at. journey_items therefore
-- gets its own updated_at trigger that leaves updated_at alone when an
-- UPDATE changes nothing but lead_interest / lead_interest_at, so the
-- backfill, a repeat tap and a lead's later no all keep the item's real
-- last-activity time (lead_interest_at carries the time of the yes).
--
-- The Helper's side is copilot_property_interest_v2 in
-- 20261024163200_copilot_property_interest_said_interested.sql, a new
-- function and so additive on its own.
--
-- Not additive: hold until the production PR is green and merged.
-- ============================================================

CREATE OR REPLACE FUNCTION public.journey_items_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old journey_items;
  v_new journey_items;
BEGIN
  v_old := OLD;
  v_new := NEW;
  v_old.lead_interest := NULL;
  v_old.lead_interest_at := NULL;
  v_old.updated_at := NULL;
  v_new.lead_interest := NULL;
  v_new.lead_interest_at := NULL;
  v_new.updated_at := NULL;
  IF v_new IS NOT DISTINCT FROM v_old THEN
    NEW.updated_at := OLD.updated_at;
  ELSE
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.journey_items_set_updated_at() IS
  'BEFORE UPDATE on journey_items: bumps updated_at for every change except one that touches only lead_interest / lead_interest_at, which records what the lead said rather than activity on the item.';

CREATE OR REPLACE TRIGGER set_journey_items_updated_at
  BEFORE UPDATE ON journey_items
  FOR EACH ROW EXECUTE FUNCTION public.journey_items_set_updated_at();

WITH first_stage AS (
  SELECT DISTINCT ON (account_id) account_id, id
  FROM journey_stages
  WHERE pipeline_stage_id IS NOT NULL
  ORDER BY account_id, position, id
),
signals AS (
  SELECT f.account_id, f.contact_id, f.property_id,
         'interested'::TEXT AS kind, COALESCE(f.updated_at, f.created_at) AS at
  FROM listing_feedback f
  WHERE f.verdict = 'interested'
  UNION ALL
  SELECT l.account_id, l.contact_id, l.property_id,
         'shortlisted'::TEXT AS kind, l.created_at AS at
  FROM property_likes l
  WHERE l.contact_id IS NOT NULL
    AND l.session_key LIKE 'wa:%'
    AND NOT EXISTS (
      SELECT 1 FROM listing_feedback f
      WHERE f.contact_id = l.contact_id
        AND f.property_id = l.property_id
        AND f.verdict = 'rejected'
        AND f.source = 'contact'
        AND COALESCE(f.updated_at, f.created_at) > l.created_at
    )
),
ranked AS (
  SELECT DISTINCT ON (s.account_id, s.contact_id, s.property_id)
    s.account_id, s.contact_id, s.property_id, s.kind, s.at
  FROM signals s
  JOIN contacts c ON c.id = s.contact_id AND c.account_id = s.account_id
  JOIN properties p ON p.id = s.property_id AND p.account_id = s.account_id
  ORDER BY s.account_id, s.contact_id, s.property_id,
           CASE s.kind WHEN 'interested' THEN 0 ELSE 1 END, s.at DESC
),
inserted AS (
  INSERT INTO journey_items (
    account_id, contact_id, property_id, stage_id, source, hidden,
    lead_interest, lead_interest_at, created_at, updated_at
  )
  SELECT
    r.account_id, r.contact_id, r.property_id, fs.id,
    CASE WHEN EXISTS (
      SELECT 1 FROM contact_property_inquiries cpi
      WHERE cpi.contact_id = r.contact_id AND cpi.property_id = r.property_id
    ) THEN 'inquiry_import' ELSE 'whatsapp_share' END,
    TRUE, r.kind, r.at, r.at, r.at
  FROM ranked r
  JOIN first_stage fs ON fs.account_id = r.account_id
  WHERE NOT EXISTS (
    SELECT 1 FROM journey_items ji
    WHERE ji.account_id = r.account_id
      AND ji.contact_id = r.contact_id
      AND ji.property_id = r.property_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM property_shares ps
    WHERE ps.account_id = r.account_id
      AND ps.contact_id = r.contact_id
      AND ps.property_id = r.property_id
  )
  ON CONFLICT (account_id, contact_id, property_id) DO NOTHING
  RETURNING id, account_id, stage_id, created_at
),
logged AS (
  INSERT INTO journey_events (
    account_id, item_id, event_type, to_stage_id, reason, created_at
  )
  SELECT account_id, id, 'added', stage_id, 'Captured from lead interest', created_at
  FROM inserted
)
UPDATE journey_items ji
SET lead_interest = r.kind,
    lead_interest_at = r.at
FROM ranked r
WHERE ji.account_id = r.account_id
  AND ji.contact_id = r.contact_id
  AND ji.property_id = r.property_id
  AND (ji.lead_interest IS NULL
       OR (ji.lead_interest = 'shortlisted' AND r.kind = 'interested')
       OR (ji.lead_interest = r.kind AND ji.lead_interest_at IS DISTINCT FROM r.at));

CREATE OR REPLACE FUNCTION public.journey_overview_groups(
  p_account_id UUID,
  p_mode TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_mode NOT IN ('buyer', 'property')
     OR NOT is_account_member(p_account_id) THEN
    RETURN '[]'::JSONB;
  END IF;

  RETURN (
    WITH lost_stage AS (
      SELECT stages.id
      FROM journey_stages stages
      WHERE stages.account_id = p_account_id
        AND stages.stage_kind = 'lost'
        AND stages.pipeline_stage_id IS NOT NULL
      ORDER BY stages.position, stages.id
      LIMIT 1
    ),
    grouped AS (
      SELECT
        CASE
          WHEN p_mode = 'buyer' THEN items.contact_id
          ELSE items.property_id
        END AS subject_id,
        count(*) FILTER (
          WHERE NOT items.hidden AND items.status = 'active'
        ) AS active_count,
        count(*) FILTER (
          WHERE NOT items.hidden AND items.status = 'dropped'
        ) AS dropped_count,
        count(*) FILTER (WHERE items.hidden) AS captured_count,
        count(*) FILTER (WHERE items.lead_interest IS NOT NULL) AS interested_count,
        (array_agg(stages.id ORDER BY stages.position DESC) FILTER (
          WHERE NOT items.hidden AND items.status = 'active'
        ))[1] AS live_stage_id,
        (array_agg(stages.id ORDER BY stages.position DESC))[1]
          AS furthest_stage_id,
        max(items.updated_at) AS last_updated
      FROM journey_items items
      JOIN journey_stages stages
        ON stages.id = items.stage_id
       AND stages.account_id = p_account_id
      WHERE items.account_id = p_account_id
      GROUP BY 1
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'subject_id', grouped.subject_id,
          'active_count', grouped.active_count,
          'dropped_count', grouped.dropped_count,
          'captured_count', grouped.captured_count,
          'interested_count', grouped.interested_count,
          'furthest_stage_id', COALESCE(
            grouped.live_stage_id,
            CASE
              WHEN grouped.dropped_count > 0
                THEN (SELECT lost_stage.id FROM lost_stage)
            END,
            grouped.furthest_stage_id
          ),
          'lost_stage_id', CASE
            WHEN grouped.dropped_count > 0
              THEN (SELECT lost_stage.id FROM lost_stage)
          END,
          'last_updated', grouped.last_updated,
          'contact_name', contacts.name,
          'contact_phone', contacts.phone,
          'contact_name_tag', contacts.name_tag,
          'property_title', properties.title,
          'property_code', properties.property_code,
          'property_location', properties.location
        )
        ORDER BY grouped.subject_id
      ),
      '[]'::JSONB
    )
    FROM grouped
    LEFT JOIN contacts
      ON p_mode = 'buyer'
     AND contacts.id = grouped.subject_id
     AND contacts.account_id = p_account_id
     AND (
       EXISTS (
         SELECT 1 FROM profiles profile
         WHERE profile.user_id = (SELECT auth.uid())
           AND profile.account_id = contacts.account_id
           AND profile.org_role IN ('org_manager', 'org_coordinator')
       )
       OR contacts.assigned_agent_id = (SELECT auth.uid())
       OR (
         contacts.assigned_team_id IS NOT NULL
         AND contacts.assigned_team_id = (
           SELECT profile.team_id FROM profiles profile
           WHERE profile.user_id = (SELECT auth.uid())
             AND profile.account_id = contacts.account_id
         )
       )
       OR (
         contacts.assigned_agent_id IS NULL
         AND contacts.assigned_team_id IS NULL
         AND EXISTS (
           SELECT 1 FROM profiles profile
           WHERE profile.user_id = (SELECT auth.uid())
             AND profile.account_id = contacts.account_id
             AND profile.org_role IN ('org_manager', 'org_leader')
         )
       )
     )
    LEFT JOIN properties
      ON p_mode = 'property'
     AND properties.id = grouped.subject_id
     AND properties.account_id = p_account_id
  );
END;
$$;

COMMENT ON FUNCTION public.journey_overview_groups(UUID, TEXT) IS
  'Account-scoped buyer/property Journey summaries. A journey sits at the furthest stage of its live items, and also at the account''s lost stage (lost_stage_id) while any item is dropped; with nothing live it sits at the lost stage alone. interested_count is how many of the journey''s items carry the lead''s own yes (lead_interest). Contact identity fields preserve the caller-visible contacts_select team and assignment scope.';

CREATE OR REPLACE FUNCTION public.journey_capture_from_share()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage UUID;
  v_item UUID;
  v_item_stage UUID;
BEGIN
  SELECT id INTO v_stage
  FROM journey_stages
  WHERE account_id = NEW.account_id AND pipeline_stage_id IS NOT NULL
  ORDER BY position, id
  LIMIT 1;
  IF v_stage IS NULL THEN
    PERFORM journey_stages_for_account(NEW.account_id);
    SELECT id INTO v_stage
    FROM journey_stages
    WHERE account_id = NEW.account_id AND pipeline_stage_id IS NOT NULL
    ORDER BY position, id
    LIMIT 1;
  END IF;
  IF v_stage IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO journey_items (
    account_id, contact_id, property_id, stage_id, source, hidden, created_by
  )
  VALUES (
    NEW.account_id, NEW.contact_id, NEW.property_id, v_stage,
    'whatsapp_share', NOT NEW.journey_visible, NEW.created_by
  )
  ON CONFLICT (account_id, contact_id, property_id) DO NOTHING
  RETURNING id INTO v_item;

  IF v_item IS NOT NULL THEN
    INSERT INTO journey_events (
      account_id, item_id, event_type, to_stage_id, reason, created_by
    )
    VALUES (
      NEW.account_id, v_item, 'added', v_stage,
      'Captured from WhatsApp share', NEW.created_by
    );
  ELSIF NEW.journey_visible THEN
    UPDATE journey_items ji
    SET hidden = FALSE
    WHERE ji.account_id = NEW.account_id
      AND ji.contact_id = NEW.contact_id
      AND ji.property_id = NEW.property_id
      AND ji.hidden
      AND EXISTS (
        SELECT 1 FROM journey_events e
        WHERE e.item_id = ji.id
          AND e.event_type = 'added'
          AND e.reason = 'Captured from lead interest'
      )
      AND NOT EXISTS (
        SELECT 1 FROM journey_events e
        WHERE e.item_id = ji.id
          AND e.event_type IN ('hidden', 'unhidden')
      )
    RETURNING ji.id, ji.stage_id INTO v_item, v_item_stage;
    IF v_item IS NOT NULL THEN
      INSERT INTO journey_events (
        account_id, item_id, event_type, from_stage_id, to_stage_id, reason, created_by
      )
      VALUES (
        NEW.account_id, v_item, 'unhidden', v_item_stage, v_item_stage,
        'Shown by a visible capture', NEW.created_by
      );
      PERFORM journey_open_deal_for_item(v_item);
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'journey_capture_from_share: % (share %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.journey_capture_from_share() IS
  'AFTER INSERT on property_shares: captures the contact×property pair on the journey at the account''s first mirrored stage, visible when the ledger row says journey_visible, otherwise hidden in the Captured tray. An existing pair is left untouched, except that a visible row shows a pair only a lead''s own yes had captured hidden (its added event reads Captured from lead interest) and nobody has reviewed since.';
