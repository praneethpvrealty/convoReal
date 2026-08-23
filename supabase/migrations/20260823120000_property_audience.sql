-- ============================================================
-- 20260823120000_property_audience.sql
-- The audience of one listing: everyone who engaged with it.
--
-- Sharing a listing has always started from preference matching — who
-- *fits* this property. The other half was missing: who already showed
-- interest in a listing, so a new arrival can go to them in one action
-- instead of being hand-picked out of the match list.
--
-- Two sources, unioned per contact: an enquiry
-- (contact_property_inquiries) and an identified showcase view
-- (showcase_events.contact_id). Anonymous and forwarded views carry no
-- identity and cannot be messaged, so they are excluded by the join.
--
-- Aggregated in SQL per §2.6 of AGENTS.md: both sources grow with
-- showcase traffic, and the caller only ever needs one row per contact.
-- SECURITY DEFINER + is_account_member() mirrors pulse_property_viewers
-- (migration 172) — contact_property_inquiries still carries the legacy
-- per-user RLS policy from migration 062, which would hide a
-- teammate's enquiries from the agent doing the share. Its account_id
-- is nullable (migration 259), so tenancy is enforced by the join onto
-- contacts rather than by that column.
-- ============================================================

CREATE OR REPLACE FUNCTION public.property_audience(
  p_account_id UUID,
  p_property_id UUID
)
RETURNS TABLE (
  contact_id UUID,
  name TEXT,
  phone TEXT,
  classification TEXT,
  name_tag TEXT,
  enquired BOOLEAN,
  viewed BOOLEAN,
  views_count BIGINT,
  last_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH engagement AS (
    SELECT
      cpi.contact_id,
      TRUE AS enquired,
      FALSE AS viewed,
      0::BIGINT AS views_count,
      COALESCE(cpi.inquiry_date, cpi.created_at) AS last_at
    FROM contact_property_inquiries cpi
    WHERE (cpi.account_id = p_account_id OR cpi.account_id IS NULL)
      AND cpi.property_id = p_property_id
    UNION ALL
    SELECT
      e.contact_id,
      FALSE,
      TRUE,
      count(*) FILTER (WHERE e.event_type = 'view_property'),
      max(e.created_at)
    FROM showcase_events e
    WHERE e.account_id = p_account_id
      AND e.property_id = p_property_id
      AND e.contact_id IS NOT NULL
    GROUP BY e.contact_id
  )
  SELECT
    c.id,
    c.name,
    c.phone,
    c.classification,
    c.name_tag,
    bool_or(g.enquired),
    bool_or(g.viewed),
    COALESCE(sum(g.views_count), 0),
    max(g.last_at)
  FROM engagement g
  JOIN contacts c
    ON c.id = g.contact_id
   AND c.account_id = p_account_id
  WHERE is_account_member(p_account_id)
  GROUP BY c.id, c.name, c.phone, c.classification, c.name_tag
  ORDER BY max(g.last_at) DESC NULLS LAST;
$$;

COMMENT ON FUNCTION public.property_audience(UUID, UUID) IS
  'Contacts who engaged with one listing: enquiries and identified showcase views, one row per contact.';

-- The listings worth offering as an audience source, newest engagement
-- first. Counting in SQL keeps the picker from pulling every listing's
-- audience just to show how big each one is.
CREATE OR REPLACE FUNCTION public.account_audience_listings(
  p_account_id UUID,
  p_limit INT DEFAULT 25
)
RETURNS TABLE (
  property_id UUID,
  title TEXT,
  property_code TEXT,
  contacts_count BIGINT,
  last_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH engagement AS (
    SELECT cpi.property_id, cpi.contact_id,
           COALESCE(cpi.inquiry_date, cpi.created_at) AS at
    FROM contact_property_inquiries cpi
    WHERE cpi.account_id = p_account_id OR cpi.account_id IS NULL
    UNION
    SELECT e.property_id, e.contact_id, e.created_at
    FROM showcase_events e
    WHERE e.account_id = p_account_id
      AND e.property_id IS NOT NULL
      AND e.contact_id IS NOT NULL
  )
  SELECT
    p.id,
    p.title,
    p.property_code,
    count(DISTINCT g.contact_id),
    max(g.at)
  FROM engagement g
  JOIN properties p
    ON p.id = g.property_id
   AND p.account_id = p_account_id
  JOIN contacts c
    ON c.id = g.contact_id
   AND c.account_id = p_account_id
  WHERE is_account_member(p_account_id)
  GROUP BY p.id, p.title, p.property_code
  ORDER BY max(g.at) DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
$$;

COMMENT ON FUNCTION public.account_audience_listings(UUID, INT) IS
  'Listings that have an engaged audience, with per-listing contact counts, newest engagement first.';

CREATE INDEX IF NOT EXISTS idx_showcase_events_property_contact
  ON showcase_events(account_id, property_id, contact_id)
  WHERE contact_id IS NOT NULL;

REVOKE ALL ON FUNCTION public.property_audience(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.account_audience_listings(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.property_audience(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_audience_listings(UUID, INT) TO authenticated;
