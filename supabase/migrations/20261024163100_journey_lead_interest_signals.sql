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
--    'wa:<contact>' rows the bot writes; a showcase like is a like, not
--    a shortlist, and the Helper already counts it) stamps its journey
--    item. A pair never captured is captured hidden at the
--    account's first mirrored stage, as the share backfill did
--    (20260926115400), so it waits in the Captured tray rather than
--    appearing on the map unreviewed; Interested outranks Shortlisted.
--
-- 2. copilot_property_interest gains the lead's own Interested answers
--    as a signal (and an `interested` column and p_signal value), so
--    "who showed interest in Adithi's plot?" lists the lead who tapped
--    Interested on the bot's card. RETURNS TABLE changes, so the
--    function is dropped and re-created with the same grants.
--
-- 3. journey_overview_groups adds interested_count per journey so both
--    surfaces can show the chip on the overview row.
--
-- Not additive: hold until the production PR is green and merged.
-- ============================================================

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
    r.account_id, r.contact_id, r.property_id, fs.id, 'whatsapp_share', TRUE,
    r.kind, r.at, r.at, r.at
  FROM ranked r
  JOIN first_stage fs ON fs.account_id = r.account_id
  WHERE NOT EXISTS (
    SELECT 1 FROM journey_items ji
    WHERE ji.account_id = r.account_id
      AND ji.contact_id = r.contact_id
      AND ji.property_id = r.property_id
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

DROP FUNCTION IF EXISTS public.copilot_property_interest(UUID, UUID[], UUID[], TIMESTAMPTZ, TEXT, INT);

CREATE OR REPLACE FUNCTION public.copilot_property_interest(
  p_account_id UUID,
  p_property_ids UUID[] DEFAULT '{}'::UUID[],
  p_contact_ids UUID[] DEFAULT '{}'::UUID[],
  p_since TIMESTAMPTZ DEFAULT NULL,
  p_signal TEXT DEFAULT 'any',
  p_limit INT DEFAULT 6
)
RETURNS TABLE (
  property_id UUID,
  property_title TEXT,
  property_code TEXT,
  contact_id UUID,
  name TEXT,
  second_name TEXT,
  company TEXT,
  classification TEXT,
  enquired BOOLEAN,
  views_count BIGINT,
  shortlisted BOOLEAN,
  visited BOOLEAN,
  liked BOOLEAN,
  interested BOOLEAN,
  journey_stage TEXT,
  journey_status TEXT,
  last_at TIMESTAMPTZ,
  total BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scope AS (
    SELECT
      COALESCE(p_property_ids, '{}'::UUID[]) AS property_ids,
      COALESCE(p_contact_ids, '{}'::UUID[]) AS contact_ids,
      COALESCE(NULLIF(LOWER(BTRIM(p_signal)), ''), 'any') AS signal
  ),
  signals AS (
    SELECT
      cpi.property_id,
      cpi.contact_id,
      'enquired'::TEXT AS kind,
      NULL::TEXT AS stage,
      NULL::TEXT AS stage_status,
      COALESCE(cpi.inquiry_date, cpi.created_at) AS at
    FROM contact_property_inquiries cpi
    WHERE cpi.account_id = p_account_id OR cpi.account_id IS NULL
    UNION ALL
    SELECT e.property_id, e.contact_id, 'viewed', NULL, NULL, e.created_at
    FROM showcase_events e
    WHERE e.account_id = p_account_id
      AND e.event_type = 'view_property'
      AND e.property_id IS NOT NULL
      AND e.contact_id IS NOT NULL
    UNION ALL
    SELECT d.property_id, d.contact_id, 'shortlisted', NULL, NULL, d.created_at
    FROM deals d
    WHERE d.account_id = p_account_id
      AND d.property_id IS NOT NULL
    UNION ALL
    SELECT a.property_id, att.contact_id, 'visited', NULL, NULL, a.start_time
    FROM appointments a
    CROSS JOIN LATERAL UNNEST(
      CASE WHEN CARDINALITY(COALESCE(a.contact_ids, '{}'::UUID[])) > 0
           THEN a.contact_ids
           ELSE ARRAY[a.contact_id]
      END
    ) AS att(contact_id)
    WHERE a.account_id = p_account_id
      AND a.event_type = 'site_visit'
      AND a.property_id IS NOT NULL
      AND att.contact_id IS NOT NULL
      AND COALESCE(a.status, '') <> 'cancelled'
      AND (a.status = 'completed' OR a.start_time <= NOW())
    UNION ALL
    SELECT
      j.property_id,
      j.contact_id,
      'journey',
      s.name,
      j.status,
      COALESCE(j.dropped_at, j.updated_at, j.created_at)
    FROM journey_items j
    LEFT JOIN journey_stages s ON s.id = j.stage_id
    WHERE j.account_id = p_account_id
      AND COALESCE(j.hidden, FALSE) = FALSE
    UNION ALL
    SELECT l.property_id, l.contact_id, 'liked', NULL, NULL, l.created_at
    FROM property_likes l
    WHERE l.account_id = p_account_id
      AND l.contact_id IS NOT NULL
    UNION ALL
    SELECT f.property_id, f.contact_id, 'interested', NULL, NULL, COALESCE(f.updated_at, f.created_at)
    FROM listing_feedback f
    WHERE f.account_id = p_account_id
      AND f.verdict = 'interested'
  ),
  scoped AS (
    SELECT s.*
    FROM signals s, scope sc
    WHERE (CARDINALITY(sc.property_ids) = 0 OR s.property_id = ANY (sc.property_ids))
      AND (CARDINALITY(sc.contact_ids) = 0 OR s.contact_id = ANY (sc.contact_ids))
      AND (CARDINALITY(sc.property_ids) > 0 OR CARDINALITY(sc.contact_ids) > 0 OR p_since IS NOT NULL)
      AND (p_since IS NULL OR s.at >= p_since)
  ),
  pairs AS (
    SELECT
      s.property_id,
      s.contact_id,
      BOOL_OR(s.kind = 'enquired') AS enquired,
      COUNT(*) FILTER (WHERE s.kind = 'viewed')::BIGINT AS views_count,
      BOOL_OR(s.kind = 'shortlisted') AS shortlisted,
      BOOL_OR(s.kind = 'visited') AS visited,
      BOOL_OR(s.kind = 'liked') AS liked,
      BOOL_OR(s.kind = 'interested') AS interested,
      (ARRAY_AGG(s.stage ORDER BY s.at DESC) FILTER (WHERE s.kind = 'journey'))[1] AS journey_stage,
      (ARRAY_AGG(s.stage_status ORDER BY s.at DESC) FILTER (WHERE s.kind = 'journey'))[1] AS journey_status,
      MAX(s.at) AS last_at
    FROM scoped s
    GROUP BY s.property_id, s.contact_id
  ),
  visible AS (
    SELECT
      p.id AS property_id,
      p.title::TEXT AS property_title,
      p.property_code::TEXT AS property_code,
      c.id AS contact_id,
      c.name::TEXT AS name,
      c.second_name::TEXT AS second_name,
      c.company::TEXT AS company,
      c.classification::TEXT AS classification,
      pr.enquired,
      pr.views_count,
      pr.shortlisted,
      pr.visited,
      pr.liked,
      pr.interested,
      pr.journey_stage,
      pr.journey_status,
      pr.last_at
    FROM pairs pr
    JOIN properties p
      ON p.id = pr.property_id
     AND p.account_id = p_account_id
    JOIN contacts c
      ON c.id = pr.contact_id
     AND c.account_id = p_account_id
     AND c.merged_into_id IS NULL
     AND COALESCE(c.chain_only, FALSE) = FALSE
    CROSS JOIN scope sc
    WHERE public.is_account_member(p_account_id)
      AND (p.owner_contact_id IS NULL OR p.owner_contact_id <> c.id)
      AND (
        sc.signal = 'any'
        OR (sc.signal = 'enquired' AND pr.enquired)
        OR (sc.signal = 'viewed' AND pr.views_count > 0)
        OR (sc.signal = 'shortlisted' AND (pr.shortlisted OR pr.journey_stage ILIKE '%shortlist%'))
        OR (sc.signal = 'visited' AND pr.visited)
        OR (sc.signal = 'liked' AND pr.liked)
        OR (sc.signal = 'interested' AND pr.interested)
      )
  ),
  keyed AS (
    SELECT
      v.*,
      CASE WHEN CARDINALITY((SELECT contact_ids FROM scope)) > 0
           THEN v.property_id
           ELSE v.contact_id
      END AS group_key
    FROM visible v
  ),
  collapsed AS (
    SELECT DISTINCT ON (k.group_key) k.*
    FROM keyed k
    ORDER BY k.group_key, k.last_at DESC NULLS LAST, k.property_id, k.contact_id
  )
  SELECT
    c.property_id,
    c.property_title,
    c.property_code,
    c.contact_id,
    c.name,
    c.second_name,
    c.company,
    c.classification,
    c.enquired,
    c.views_count,
    c.shortlisted,
    c.visited,
    c.liked,
    c.interested,
    c.journey_stage,
    c.journey_status,
    c.last_at,
    COUNT(*) OVER ()::BIGINT AS total
  FROM collapsed c
  ORDER BY c.last_at DESC NULLS LAST, c.contact_id, c.property_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 6), 1), 10);
$$;

COMMENT ON FUNCTION public.copilot_property_interest(UUID, UUID[], UUID[], TIMESTAMPTZ, TEXT, INT) IS
  'Helper: contacts who showed interest in given listings (one row per contact), or listings a given contact showed interest in (one row per listing) — enquiries, identified showcase views, deals, elapsed site visits, visible journey items, likes and the lead''s own Interested answers on listing_feedback.';

REVOKE ALL ON FUNCTION public.copilot_property_interest(UUID, UUID[], UUID[], TIMESTAMPTZ, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copilot_property_interest(UUID, UUID[], UUID[], TIMESTAMPTZ, TEXT, INT) TO authenticated;

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
