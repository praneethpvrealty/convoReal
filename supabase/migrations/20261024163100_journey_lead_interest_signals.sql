-- ============================================================
-- 20261024163100_journey_lead_interest_signals.sql
--
-- Reads and backfills the lead_interest stamp that
-- 20261024163000_journey_lead_interest.sql added to journey_items.
-- A lead's own yes (an Interested answer on listing_feedback, a WhatsApp
-- Shortlist tap on property_likes) stamps the pair's journey item; it
-- never creates one, so a pair the agent removed from the tray stays
-- removed (JRN-009).
--
-- 1. updated_at. The stamp records what the lead said, not activity on
--    the item: the overview's last_updated, the closing-nudge stall
--    clock and the Helper's signal time all read updated_at.
--    journey_items therefore gets its own updated_at trigger that leaves
--    updated_at alone when an UPDATE changes lead_interest /
--    lead_interest_at and nothing else (lead_interest_at carries the
--    time of the yes); every other update, a bare SET updated_at = now()
--    that records a client's reply or a visit request included, bumps
--    it as before.
--
-- 2. Seed on capture. When a pair is captured after the lead already
--    said yes (a share, an import, a visit request), the insert trigger
--    copies the strongest yes on file onto the new row, so the Journey
--    tab lists the lead whichever came first. The lookup is scoped to
--    the row's account: a journey_items insert is not checked against
--    the contact's and the property's account, so an unscoped read from
--    a SECURITY DEFINER trigger would copy another account's answer
--    onto a row the inserter can read back.
--
-- 3. Backfill. Every journey item whose pair has an Interested answer
--    (the Interested tap, a typed WhatsApp enquiry, a portal enquiry, a
--    showcase check-in visit or call: the same writers that stamp live;
--    a later rejection overwrote the verdict, so a lead who then said no
--    is left out) or a WhatsApp Shortlist tap (the session_key
--    'wa:<contact>' rows the bot writes, matched exactly because the
--    public like route stores any key its caller sends, unless the lead
--    themselves said
--    no to that listing after the tap, as the live clear does; a
--    showcase like is a like, not a shortlist, and the Helper already
--    counts it) is stamped. Interested outranks Shortlisted.
--
-- 4. journey_overview_groups adds interested_count per journey so both
--    surfaces can show the chip on the overview row, and
--    interested_hidden_count, how many of those still sit in the
--    Captured tray, so the chip opens the tray when that is where the
--    lead is.
--
-- The Helper's side is copilot_property_interest_v2 in
-- 20261024163200_copilot_property_interest_said_interested.sql, a new
-- function and so additive on its own.
--
-- Not additive (replaces a live trigger and a live function): hold
-- until the production PR is green and merged.
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
  v_new.lead_interest := NULL;
  v_new.lead_interest_at := NULL;
  IF v_new IS NOT DISTINCT FROM v_old
     AND (NEW.lead_interest, NEW.lead_interest_at)
         IS DISTINCT FROM (OLD.lead_interest, OLD.lead_interest_at) THEN
    NEW.updated_at := OLD.updated_at;
  ELSE
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.journey_items_set_updated_at() IS
  'BEFORE UPDATE on journey_items: bumps updated_at for every update, including a bare SET updated_at = now() that records activity, except one that changes lead_interest / lead_interest_at and nothing else, which records what the lead said rather than activity on the item.';

CREATE OR REPLACE TRIGGER set_journey_items_updated_at
  BEFORE UPDATE ON journey_items
  FOR EACH ROW EXECUTE FUNCTION public.journey_items_set_updated_at();

CREATE OR REPLACE FUNCTION public.journey_lead_interest_on_file(
  p_account_id UUID,
  p_contact_id UUID,
  p_property_id UUID,
  OUT lead_interest TEXT,
  OUT lead_interest_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT s.kind, s.at
  FROM (
    SELECT 'interested'::TEXT AS kind, COALESCE(f.updated_at, f.created_at) AS at
    FROM listing_feedback f
    WHERE f.account_id = p_account_id
      AND f.contact_id = p_contact_id
      AND f.property_id = p_property_id
      AND f.verdict = 'interested'
    UNION ALL
    SELECT 'shortlisted'::TEXT AS kind, l.created_at AS at
    FROM property_likes l
    WHERE l.account_id = p_account_id
      AND l.contact_id = p_contact_id
      AND l.property_id = p_property_id
      AND l.session_key = 'wa:' || p_contact_id::text
      AND NOT EXISTS (
        SELECT 1 FROM listing_feedback f
        WHERE f.account_id = l.account_id
          AND f.contact_id = l.contact_id
          AND f.property_id = l.property_id
          AND f.verdict = 'rejected'
          AND f.source = 'contact'
          AND COALESCE(f.updated_at, f.created_at) > l.created_at
      )
  ) s
  ORDER BY CASE s.kind WHEN 'interested' THEN 0 ELSE 1 END, s.at DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.journey_lead_interest_on_file(UUID, UUID, UUID) IS
  'The strongest yes a lead gave on a listing themselves, within the given account: an Interested answer on listing_feedback outranks a WhatsApp Shortlist tap on property_likes that the lead did not take back; NULLs when there is none.';

REVOKE ALL ON FUNCTION public.journey_lead_interest_on_file(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.journey_items_seed_lead_interest()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.lead_interest IS NULL THEN
    SELECT y.lead_interest, y.lead_interest_at
    INTO NEW.lead_interest, NEW.lead_interest_at
    FROM journey_lead_interest_on_file(NEW.account_id, NEW.contact_id, NEW.property_id) y;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.journey_items_seed_lead_interest() IS
  'BEFORE INSERT on journey_items: a pair captured after the lead already said yes carries that yes from the start.';

CREATE OR REPLACE TRIGGER seed_journey_items_lead_interest
  BEFORE INSERT ON journey_items
  FOR EACH ROW EXECUTE FUNCTION public.journey_items_seed_lead_interest();

UPDATE journey_items ji
SET lead_interest = y.lead_interest,
    lead_interest_at = y.lead_interest_at
FROM journey_items j2
CROSS JOIN LATERAL journey_lead_interest_on_file(j2.account_id, j2.contact_id, j2.property_id) y
WHERE ji.id = j2.id
  AND y.lead_interest IS NOT NULL
  AND (ji.lead_interest IS NULL
       OR (ji.lead_interest = 'shortlisted' AND y.lead_interest = 'interested')
       OR (ji.lead_interest = y.lead_interest
           AND ji.lead_interest_at IS DISTINCT FROM y.lead_interest_at));

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
        count(*) FILTER (
          WHERE items.hidden AND items.lead_interest IS NOT NULL
        ) AS interested_hidden_count,
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
          'interested_hidden_count', grouped.interested_hidden_count,
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
  'Account-scoped buyer/property Journey summaries. A journey sits at the furthest stage of its live items, and also at the account''s lost stage (lost_stage_id) while any item is dropped; with nothing live it sits at the lost stage alone. interested_count is how many of the journey''s items carry the lead''s own yes (lead_interest), interested_hidden_count how many of those are still captured (hidden). Contact identity fields preserve the caller-visible contacts_select team and assignment scope.';
