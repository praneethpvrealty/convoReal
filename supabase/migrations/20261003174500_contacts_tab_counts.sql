-- ============================================================
-- 20261003174500_contacts_tab_counts.sql
-- Collapse the Contacts page's six tab counters into one pass over
-- the account's contacts, on web and mobile alike.
--
-- contacts-content.tsx issued six PostgREST `count: 'exact'` HEAD
-- requests on every load (Active, Needs Review, Favourites,
-- Transacted, Active Buyers, Archived), after first fetching every
-- won deal's contact_id to build the Transacted filter. Each HEAD
-- request is a real COUNT(*) over the account's contacts, so one
-- visit scanned them six times. The mobile contacts tab ran its own
-- four, with a different staff-exclusion rule and a Transacted count
-- that ignored archived and merged contacts — the two surfaces could
-- disagree about the same account.
--
-- FILTER aggregates give all six numbers from a single scan, and the
-- staff and won-deal rules live here once.
-- ============================================================

-- SECURITY DEFINER so the aggregate runs without per-row RLS
-- evaluation, with the membership check done once in the WHERE
-- clause: a non-member gets a row of zeros rather than another
-- account's totals (same shape as inventory_stats, migration 168).
CREATE OR REPLACE FUNCTION public.contacts_tab_counts(p_account_id UUID)
RETURNS TABLE (
  active BIGINT,
  pending_review BIGINT,
  favorites BIGINT,
  transacted BIGINT,
  market_active BIGINT,
  archived BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH staff AS (
    -- Team members message the shared number too, which lands their
    -- own phones in contacts. The web list matches them on the last
    -- eight digits of each profile phone; so does this.
    SELECT DISTINCT right(regexp_replace(pr.phone, '\D', '', 'g'), 8) AS suffix
    FROM profiles pr
    WHERE pr.account_id = p_account_id
      AND length(regexp_replace(pr.phone, '\D', '', 'g')) >= 8
  ),
  live AS (
    SELECT c.id, c.status, c.is_favorite, c.is_archived,
           c.lead_temp, c.last_inquired_property_id
    FROM contacts c
    WHERE c.account_id = p_account_id
      AND c.is_merged = false
      AND c.chain_only = false
      AND NOT EXISTS (
        SELECT 1 FROM staff s WHERE c.phone LIKE '%' || s.suffix
      )
  )
  SELECT
    count(*) FILTER (WHERE l.status = 'active' AND NOT l.is_archived),
    count(*) FILTER (WHERE l.status = 'pending_review' AND NOT l.is_archived),
    count(*) FILTER (WHERE l.is_favorite AND NOT l.is_archived),
    count(*) FILTER (
      WHERE l.status = 'active' AND NOT l.is_archived
        AND EXISTS (
          SELECT 1 FROM deals d
          WHERE d.account_id = p_account_id
            AND d.contact_id = l.id
            AND d.status = 'won'
        )
    ),
    count(*) FILTER (
      WHERE l.status = 'active' AND NOT l.is_archived
        AND (l.lead_temp = 'HOT' OR l.last_inquired_property_id IS NOT NULL)
    ),
    count(*) FILTER (WHERE l.is_archived)
  FROM live l
  WHERE is_account_member(p_account_id);
$$;

COMMENT ON FUNCTION public.contacts_tab_counts(UUID) IS
  'Contacts page tab counters for one account in a single scan. Replaces six count=exact round trips from the web page and four from the mobile tab.';

REVOKE ALL ON FUNCTION public.contacts_tab_counts(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contacts_tab_counts(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.contacts_tab_counts(UUID) TO authenticated;
