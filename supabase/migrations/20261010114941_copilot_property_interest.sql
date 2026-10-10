-- ============================================================
-- 20261010114941_copilot_property_interest.sql
--
-- The Helper answers "which buyers showed interest in Adithi's
-- property?" and "what has Ramesh enquired about?" from the interest
-- a contact has already shown in a listing, not from the preferences
-- copilot_find_contacts matches. Every signal the owner digest and the
-- listing audience already count is unioned per (property, contact):
-- an enquiry (contact_property_inquiries), an identified showcase view
-- (showcase_events.contact_id), a deal on the property (the buyer was
-- shortlisted), a site visit that has taken place (appointments, every
-- attendee, dated by start_time), a journey item the agent placed on
-- the map with its stage and whether it dropped, and an identified
-- showcase like. A journey row still hidden in the Captured tray is a
-- share the agent sent, not interest the contact showed, so it is left
-- out (migration 138); "shortlisted" means a deal or a journey stage
-- named for it, never the bare existence of a journey row.
--
-- Aggregated in SQL per §2.6 of AGENTS.md. SECURITY DEFINER with the
-- is_account_member() guard mirrors property_audience (migration
-- 20260823120000): contact_property_inquiries still carries the legacy
-- per-user policy from migration 062, which would hide a teammate's
-- enquiries, and its account_id is nullable (migration 259), so tenancy
-- comes from the join onto contacts and properties of p_account_id.
-- Rows collapse to one per contact when the caller names listings and
-- to one per listing when it names contacts, keeping the latest pair
-- for each, so a buyer engaged with two of an owner's listings is one
-- contact in the answer and total counts what the answer lists.
-- The caller passes bounded id arrays it resolved under RLS; a listing
-- outside the account never matches the properties join. With no ids
-- at all the window is the bound: "who enquired today" reads every
-- listing of the account since p_since, and nothing without one. The owner of
-- a listing is left out of its own interest list.
-- ============================================================

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
    c.journey_stage,
    c.journey_status,
    c.last_at,
    COUNT(*) OVER ()::BIGINT AS total
  FROM collapsed c
  ORDER BY c.last_at DESC NULLS LAST, c.contact_id, c.property_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 6), 1), 10);
$$;

COMMENT ON FUNCTION public.copilot_property_interest(UUID, UUID[], UUID[], TIMESTAMPTZ, TEXT, INT) IS
  'Helper: contacts who showed interest in given listings (one row per contact), or listings a given contact showed interest in (one row per listing) — enquiries, identified showcase views, deals, elapsed site visits, visible journey items and likes.';

REVOKE ALL ON FUNCTION public.copilot_property_interest(UUID, UUID[], UUID[], TIMESTAMPTZ, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copilot_property_interest(UUID, UUID[], UUID[], TIMESTAMPTZ, TEXT, INT) TO authenticated;
