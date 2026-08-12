-- ============================================================
-- 258_property_gate_stats.sql
--
-- Per-listing rollup of the confidential gate: how many people asked,
-- how many were let in, how many were turned away, and how many keys
-- are still live.
--
-- The gate and the approval queue shipped without this, so a listing
-- generating ten requests looked exactly like one nobody had asked
-- about. The approvals panel answers "what needs a decision now"; it
-- cannot answer "how is this listing doing", because it is a work
-- queue, account-wide, and empties as you use it.
--
-- One function for the whole account rather than a count per card:
-- a per-row COUNT(*) is a real scan each time (AGENTS.md §2.6), and
-- the inventory grid renders dozens of cards.
--
-- `live_grants` is the one an agent acts on — keys that are neither
-- expired nor revoked, i.e. people who can open the listing right now.
-- ============================================================

CREATE OR REPLACE FUNCTION property_gate_stats(target_account_id UUID)
RETURNS TABLE (
  property_id UUID,
  requested INTEGER,
  pending INTEGER,
  approved INTEGER,
  rejected INTEGER,
  live_grants INTEGER,
  last_requested_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Membership is the boundary: SECURITY DEFINER bypasses RLS, so a
  -- caller who is not in this account gets nothing rather than another
  -- brokerage's demand signal.
  SELECT
    p.id AS property_id,
    COALESCE(r.requested, 0)::INTEGER,
    COALESCE(r.pending, 0)::INTEGER,
    COALESCE(r.approved, 0)::INTEGER,
    COALESCE(r.rejected, 0)::INTEGER,
    COALESCE(g.live_grants, 0)::INTEGER,
    r.last_requested_at
  FROM properties p
  LEFT JOIN (
    SELECT
      lr.property_id,
      COUNT(*) AS requested,
      COUNT(*) FILTER (WHERE lr.status = 'pending') AS pending,
      COUNT(*) FILTER (WHERE lr.status = 'approved') AS approved,
      -- An expired consent chain is a request that never got an answer,
      -- which reads the same way to an agent as a refusal.
      COUNT(*) FILTER (WHERE lr.status IN ('rejected', 'expired')) AS rejected,
      MAX(lr.created_at) AS last_requested_at
    FROM property_location_requests lr
    WHERE lr.account_id = target_account_id
      AND lr.scope = 'listing'
    GROUP BY lr.property_id
  ) r ON r.property_id = p.id
  LEFT JOIN (
    SELECT
      sg.property_id,
      COUNT(*) AS live_grants
    FROM property_share_grants sg
    WHERE sg.account_id = target_account_id
      AND sg.reveal_listing
      AND sg.revoked_at IS NULL
      AND sg.expires_at > NOW()
    GROUP BY sg.property_id
  ) g ON g.property_id = p.id
  WHERE p.account_id = target_account_id
    AND is_account_member(target_account_id)
    -- Only listings that are gated or have history: an account with one
    -- confidential listing should not pay for 500 rows of zeroes.
    AND (
      p.showcase_visibility = 'teaser'
      OR r.requested IS NOT NULL
      OR g.live_grants IS NOT NULL
    );
$$;

COMMENT ON FUNCTION property_gate_stats(UUID) IS
  'Per-property confidential-gate rollup (migration 258). Returns only gated listings or ones with request/grant history.';

-- The rollup filters requests by scope and groups by property.
CREATE INDEX IF NOT EXISTS idx_location_requests_account_scope_property
  ON property_location_requests (account_id, scope, property_id);

-- And live keys by property.
CREATE INDEX IF NOT EXISTS idx_share_grants_account_property_live
  ON property_share_grants (account_id, property_id)
  WHERE revoked_at IS NULL;
