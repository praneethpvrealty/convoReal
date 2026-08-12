-- ============================================================
-- 257_portfolio_stats_rpcs.sql — Portfolio (owner + buyer) rollups
-- for the /api/v1 surface.
--
-- The Portfolio portals are where an account's owners and buyers act
-- on their own: an owner sees their listings and the bids on them, a
-- buyer sees their matches and shortlist. The agency has had no
-- aggregate view of either — "how much of my owners' stock is still
-- for sale", "what is my buyers' average budget" — because the data
-- lives across two link tables that nothing joined.
--
-- Scoping. den_users and buyer_users are GLOBAL identities: one
-- person may deal with several agencies, and their user row is not
-- owned by any of them. What IS tenant-scoped is the link —
-- den_contact_links / buyer_contact_links both carry account_id. So
-- every function here enters through the link table filtered to one
-- account and never reads a portal user that account has not linked.
-- A person registered with two agencies contributes to each one's
-- numbers only through that agency's own link.
--
-- SECURITY DEFINER, granted to service_role ONLY — the same posture
-- as the credit-engine functions in migration 089. These are called
-- exclusively by /api/v1 handlers, which have already established the
-- account from a verified API key (src/lib/auth/api-keys.ts), so
-- there is no session for is_account_member() to check. The RPCs in
-- 168-170 take the opposite approach because their callers are
-- browser sessions; do not copy this grant to a function the client
-- can reach.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- Owner-side lookups walk properties by owner_contact_id, which had
-- no index; every rollup below would otherwise scan the account's
-- whole inventory once per owner.
CREATE INDEX IF NOT EXISTS idx_properties_owner_contact
  ON properties(account_id, owner_contact_id)
  WHERE owner_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_den_contact_links_account_status
  ON den_contact_links(account_id, status);

CREATE INDEX IF NOT EXISTS idx_buyer_contact_links_account_status
  ON buyer_contact_links(account_id, status);

-- ------------------------------------------------------------
-- Owner side.
--
-- `listing_source <> 'agent'` mirrors resolveOwnerPropertyIds() in
-- src/lib/den/auth.ts: owner_contact_id holds the REFERRING AGENT for
-- agent-referred listings (migration 191), so counting those as an
-- owner's stock would credit the wrong person entirely.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.portfolio_owner_stats(p_account_id UUID)
RETURNS TABLE (
  linked_owners BIGINT,
  owners_with_listings BIGINT,
  properties_total BIGINT,
  properties_available BIGINT,
  properties_under_contract BIGINT,
  properties_sold BIGINT,
  properties_published BIGINT,
  asking_value_available NUMERIC,
  asking_price_avg_available NUMERIC,
  bids_pending BIGINT,
  bids_accepted BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH links AS (
    SELECT DISTINCT l.den_user_id, l.contact_id
    FROM den_contact_links l
    WHERE l.account_id = p_account_id
      AND l.status = 'active'
  ),
  -- DISTINCT on the property, not the join: a contact can carry links
  -- to more than one den_user (UNIQUE is on the pair), and a plain
  -- join would then count that owner's listings twice.
  owned AS (
    SELECT DISTINCT p.id, p.status, p.is_published, p.price
    FROM properties p
    WHERE p.account_id = p_account_id
      AND p.listing_source <> 'agent'
      AND EXISTS (SELECT 1 FROM links l WHERE l.contact_id = p.owner_contact_id)
  )
  SELECT
    (SELECT count(DISTINCT den_user_id) FROM links),
    (SELECT count(DISTINCT l.den_user_id) FROM links l
      WHERE EXISTS (
        SELECT 1 FROM properties p
        WHERE p.account_id = p_account_id
          AND p.owner_contact_id = l.contact_id
          AND p.listing_source <> 'agent'
      )),
    (SELECT count(*) FROM owned),
    (SELECT count(*) FROM owned WHERE status = 'Available'),
    (SELECT count(*) FROM owned WHERE status = 'Under Contract'),
    (SELECT count(*) FROM owned WHERE status = 'Sold'),
    (SELECT count(*) FROM owned WHERE is_published),
    (SELECT COALESCE(sum(price), 0) FROM owned WHERE status = 'Available'),
    (SELECT round(avg(price)) FROM owned WHERE status = 'Available' AND price > 0),
    (SELECT count(*) FROM property_bids b
      WHERE b.owner_account_id = p_account_id AND b.status = 'pending'),
    (SELECT count(*) FROM property_bids b
      WHERE b.owner_account_id = p_account_id AND b.status = 'accepted');
$$;

COMMENT ON FUNCTION public.portfolio_owner_stats(UUID) IS
  'Owner-side Portfolio rollup for one account: how many contacts have an owner portal login, how much stock they hold and in what state, and open bid activity. Scoped through den_contact_links.account_id.';

CREATE OR REPLACE FUNCTION public.portfolio_owner_rows(
  p_account_id UUID,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  den_user_id UUID,
  contact_id UUID,
  contact_name TEXT,
  contact_phone TEXT,
  display_name TEXT,
  linked_at TIMESTAMPTZ,
  digest_frequency TEXT,
  properties_total BIGINT,
  properties_available BIGINT,
  properties_sold BIGINT,
  asking_value_available NUMERIC,
  bids_pending BIGINT,
  total_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH links AS (
    SELECT l.den_user_id, l.contact_id, l.created_at,
           d.display_name, d.digest_frequency,
           c.name, c.second_name, c.phone
    FROM den_contact_links l
    JOIN den_users d ON d.id = l.den_user_id
    JOIN contacts c ON c.id = l.contact_id
    WHERE l.account_id = p_account_id
      AND l.status = 'active'
  ),
  rolled AS (
    SELECT
      l.den_user_id,
      l.contact_id,
      NULLIF(TRIM(CONCAT_WS(' ', l.name, l.second_name)), '') AS contact_name,
      l.phone AS contact_phone,
      l.display_name,
      l.created_at AS linked_at,
      l.digest_frequency,
      COALESCE(p.total, 0) AS properties_total,
      COALESCE(p.available, 0) AS properties_available,
      COALESCE(p.sold, 0) AS properties_sold,
      COALESCE(p.value_available, 0) AS asking_value_available,
      COALESCE(b.pending, 0) AS bids_pending
    FROM links l
    LEFT JOIN LATERAL (
      SELECT
        count(*) AS total,
        count(*) FILTER (WHERE pr.status = 'Available') AS available,
        count(*) FILTER (WHERE pr.status = 'Sold') AS sold,
        COALESCE(sum(pr.price) FILTER (WHERE pr.status = 'Available'), 0) AS value_available
      FROM properties pr
      WHERE pr.account_id = p_account_id
        AND pr.owner_contact_id = l.contact_id
        AND pr.listing_source <> 'agent'
    ) p ON TRUE
    LEFT JOIN LATERAL (
      SELECT count(*) AS pending
      FROM property_bids bd
      JOIN properties pr2 ON pr2.id = bd.property_id
      WHERE bd.owner_account_id = p_account_id
        AND bd.status = 'pending'
        AND pr2.owner_contact_id = l.contact_id
        -- Same exclusion as the listing counts above, so a bid cannot
        -- be attributed to a referring agent as though they owned it.
        AND pr2.listing_source <> 'agent'
    ) b ON TRUE
  )
  SELECT
    r.den_user_id,
    r.contact_id,
    r.contact_name,
    r.contact_phone,
    r.display_name,
    r.linked_at,
    r.digest_frequency,
    r.properties_total,
    r.properties_available,
    r.properties_sold,
    r.asking_value_available,
    r.bids_pending,
    count(*) OVER () AS total_count
  FROM rolled r
  ORDER BY r.properties_available DESC, r.asking_value_available DESC, r.linked_at DESC
  LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0);
$$;

COMMENT ON FUNCTION public.portfolio_owner_rows(UUID, INT, INT) IS
  'Per-owner Portfolio rows for one account, ranked by live stock. total_count repeats the unpaged total on every row so the caller can page without a second query.';

-- ------------------------------------------------------------
-- Buyer side.
--
-- Budget lives on the linked CONTACT, not on buyer_users — the portal
-- is a view onto the agency's own contact record, and matching reads
-- the same columns (src/lib/matching.ts). `no_budget` is a deliberate
-- "no constraint" flag rather than a missing value, so it is excluded
-- from the averages instead of being read as zero.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.portfolio_buyer_stats(p_account_id UUID)
RETURNS TABLE (
  linked_buyers BIGINT,
  buyers_with_budget BIGINT,
  buyers_unconstrained_budget BIGINT,
  buyers_with_requirement BIGINT,
  budget_min_avg NUMERIC,
  budget_max_avg NUMERIC,
  budget_max_median NUMERIC,
  budget_max_lowest NUMERIC,
  budget_max_highest NUMERIC,
  shortlist_items BIGINT,
  buyers_with_shortlist BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH links AS (
    SELECT DISTINCT l.buyer_user_id, l.contact_id
    FROM buyer_contact_links l
    WHERE l.account_id = p_account_id
      AND l.status = 'active'
  ),
  buyers AS (
    SELECT DISTINCT
      l.buyer_user_id,
      c.min_budget,
      c.max_budget,
      c.no_budget,
      c.requirements,
      c.requirement_active
    FROM links l
    JOIN contacts c ON c.id = l.contact_id
  ),
  budgeted AS (
    SELECT * FROM buyers
    WHERE COALESCE(no_budget, FALSE) = FALSE
      AND COALESCE(max_budget, 0) > 0
  )
  SELECT
    (SELECT count(DISTINCT buyer_user_id) FROM buyers),
    (SELECT count(DISTINCT buyer_user_id) FROM budgeted),
    (SELECT count(DISTINCT buyer_user_id) FROM buyers WHERE COALESCE(no_budget, FALSE)),
    (SELECT count(DISTINCT buyer_user_id) FROM buyers
      WHERE requirements IS NOT NULL
        AND TRIM(requirements) <> ''
        AND COALESCE(requirement_active, TRUE)),
    (SELECT round(avg(min_budget)) FROM budgeted WHERE COALESCE(min_budget, 0) > 0),
    (SELECT round(avg(max_budget)) FROM budgeted),
    -- percentile_cont has no NUMERIC ordered-set variant, so the input
    -- is cast to double precision explicitly rather than leaning on
    -- implicit resolution, and the result cast back for round().
    (SELECT round(
       (percentile_cont(0.5) WITHIN GROUP (ORDER BY max_budget::DOUBLE PRECISION))::NUMERIC
     ) FROM budgeted),
    (SELECT min(max_budget) FROM budgeted),
    (SELECT max(max_budget) FROM budgeted),
    (SELECT count(*) FROM buyer_shortlist_items s
      WHERE s.account_id = p_account_id
        AND EXISTS (SELECT 1 FROM links l WHERE l.buyer_user_id = s.buyer_user_id)),
    (SELECT count(DISTINCT s.buyer_user_id) FROM buyer_shortlist_items s
      WHERE s.account_id = p_account_id
        AND EXISTS (SELECT 1 FROM links l WHERE l.buyer_user_id = s.buyer_user_id));
$$;

COMMENT ON FUNCTION public.portfolio_buyer_stats(UUID) IS
  'Buyer-side Portfolio rollup for one account: how many contacts have a buyer portal login, their budget distribution, and shortlist activity. Scoped through buyer_contact_links.account_id. Contacts flagged no_budget are counted separately rather than averaged in as zero.';

CREATE OR REPLACE FUNCTION public.portfolio_buyer_rows(
  p_account_id UUID,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  buyer_user_id UUID,
  contact_id UUID,
  contact_name TEXT,
  contact_phone TEXT,
  display_name TEXT,
  linked_at TIMESTAMPTZ,
  min_budget NUMERIC,
  max_budget NUMERIC,
  no_budget BOOLEAN,
  areas_of_interest TEXT[],
  requirements TEXT,
  requirement_active BOOLEAN,
  shortlist_count BIGINT,
  total_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rolled AS (
    SELECT
      l.buyer_user_id,
      l.contact_id,
      NULLIF(TRIM(CONCAT_WS(' ', c.name, c.second_name)), '') AS contact_name,
      c.phone AS contact_phone,
      b.display_name,
      l.created_at AS linked_at,
      c.min_budget,
      c.max_budget,
      COALESCE(c.no_budget, FALSE) AS no_budget,
      c.areas_of_interest,
      c.requirements,
      COALESCE(c.requirement_active, TRUE) AS requirement_active,
      (
        SELECT count(*)
        FROM buyer_shortlist_items s
        WHERE s.account_id = p_account_id
          AND s.buyer_user_id = l.buyer_user_id
      ) AS shortlist_count
    FROM buyer_contact_links l
    JOIN buyer_users b ON b.id = l.buyer_user_id
    JOIN contacts c ON c.id = l.contact_id
    WHERE l.account_id = p_account_id
      AND l.status = 'active'
  )
  SELECT
    r.buyer_user_id,
    r.contact_id,
    r.contact_name,
    r.contact_phone,
    r.display_name,
    r.linked_at,
    r.min_budget,
    r.max_budget,
    r.no_budget,
    r.areas_of_interest,
    r.requirements,
    r.requirement_active,
    r.shortlist_count,
    count(*) OVER () AS total_count
  FROM rolled r
  ORDER BY r.max_budget DESC NULLS LAST, r.shortlist_count DESC, r.linked_at DESC
  LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0);
$$;

COMMENT ON FUNCTION public.portfolio_buyer_rows(UUID, INT, INT) IS
  'Per-buyer Portfolio rows for one account, ranked by budget. total_count repeats the unpaged total on every row so the caller can page without a second query.';

-- ------------------------------------------------------------
-- Grants. service_role only: every caller is an /api/v1 handler that
-- has already resolved the account from a verified API key. Granting
-- these to `authenticated` would hand any signed-in user the ability
-- to pass an arbitrary p_account_id, because none of them check
-- is_account_member.
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION public.portfolio_owner_stats(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portfolio_owner_rows(UUID, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portfolio_buyer_stats(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portfolio_buyer_rows(UUID, INT, INT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.portfolio_owner_stats(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.portfolio_owner_rows(UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.portfolio_buyer_stats(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.portfolio_buyer_rows(UUID, INT, INT) TO service_role;
