-- ============================================================
-- 264_contact_lead_portal_ref.sql
--
-- The portal ad a lead actually enquired about, kept on the contact.
--
-- property_portal_listings already holds the one-to-one map between a
-- portal's ad id and an Engine property (migration 124's partial unique
-- index on (account_id, portal, portal_listing_id) is what makes it one
-- to one), and the lead webhook already resolves a lead through it
-- before it scores anything. What was missing is the first assertion:
-- until an agent says "this Housing ad IS this listing" there is no row
-- to resolve through, so every lead on that ad falls back to guessing
-- by type/locality/price.
--
-- These two columns carry the ad's identity on the lead itself, so the
-- agent can make that assertion from the contact in front of them, and
-- so asserting it can retro-tag every other lead that quoted the same
-- ad and is still waiting.
--
-- Nullable by nature: leads arrive by WhatsApp, referral and manual
-- entry too, and those have no portal ad behind them.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_portal TEXT,
  ADD COLUMN IF NOT EXISTS lead_portal_listing_id TEXT;

COMMENT ON COLUMN contacts.lead_portal IS
  'Portal whose ad this lead came in on: 99acres | magicbricks | housing. Null for non-portal leads.';
COMMENT ON COLUMN contacts.lead_portal_listing_id IS
  'The portal''s own ad id as quoted in the lead email. Matched against property_portal_listings.portal_listing_id for exact attribution.';

-- Drives both the retro-tag sweep after an agent asserts a mapping and
-- the "ads still unmapped" queue, which are the same lookup.
CREATE INDEX IF NOT EXISTS idx_contacts_lead_portal_ref
  ON contacts (account_id, lead_portal, lead_portal_listing_id)
  WHERE lead_portal_listing_id IS NOT NULL;

-- ── The queue of ads still waiting on their first assertion ──
--
-- One row per distinct ad, not per lead: an ad with nine enquiries is
-- one decision, and asking the agent nine times is how a queue stops
-- being used. Aggregated here rather than in the browser (AGENTS.md
-- §2.6) — the alternative is shipping every portal lead in the account
-- to the client to group them.
--
-- `guessed_property_id` is what the scorer picked for the most recent
-- lead on the ad. It is a starting point for the agent, never an
-- answer: leads that arrive with no locality to go on are exactly the
-- ones that end up filed against whichever listing of that type is
-- newest, which is what the queue exists to correct.
CREATE OR REPLACE FUNCTION unmapped_portal_ads(target_account_id UUID)
RETURNS TABLE (
  portal TEXT,
  portal_listing_id TEXT,
  lead_count BIGINT,
  last_seen_at TIMESTAMPTZ,
  sample_contact_id UUID,
  sample_contact_name TEXT,
  guessed_property_id UUID,
  guessed_property_title TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    latest.lead_portal,
    latest.lead_portal_listing_id,
    latest.lead_count,
    latest.last_seen_at,
    latest.id,
    latest.name,
    latest.last_inquired_property_id,
    p.title
  FROM (
    SELECT DISTINCT ON (c.lead_portal, c.lead_portal_listing_id)
      c.lead_portal,
      c.lead_portal_listing_id,
      c.id,
      c.name,
      c.last_inquired_property_id,
      COUNT(*) OVER (PARTITION BY c.lead_portal, c.lead_portal_listing_id) AS lead_count,
      MAX(c.created_at) OVER (PARTITION BY c.lead_portal, c.lead_portal_listing_id) AS last_seen_at
    FROM contacts c
    WHERE c.account_id = target_account_id
      AND c.lead_portal IS NOT NULL
      AND c.lead_portal_listing_id IS NOT NULL
      -- Correlated, so the ad ids never travel out to the client and
      -- back in an `.in()` filter (AGENTS.md §2.6).
      AND NOT EXISTS (
        SELECT 1 FROM property_portal_listings ppl
        WHERE ppl.account_id = target_account_id
          AND ppl.portal = c.lead_portal
          AND ppl.portal_listing_id = c.lead_portal_listing_id
      )
    ORDER BY c.lead_portal, c.lead_portal_listing_id, c.created_at DESC
  ) AS latest
  LEFT JOIN properties p
    ON p.id = latest.last_inquired_property_id
   AND p.account_id = target_account_id
  WHERE is_account_member(target_account_id)
  ORDER BY latest.last_seen_at DESC
  LIMIT 100;
$$;

COMMENT ON FUNCTION unmapped_portal_ads(UUID) IS
  'Portal ads with leads waiting and no property_portal_listings row yet. SECURITY DEFINER, guarded by is_account_member.';

-- PostgREST exposes every public function at /rest/v1/rpc/, and the anon
-- key ships in the browser bundle, so a new SECURITY DEFINER function is
-- callable by anyone until its grants are closed (migration 263).
--
-- Revoking PUBLIC is not sufficient here: Supabase's default privileges
-- grant EXECUTE to anon and authenticated as ROLES, not through PUBLIC,
-- so those entries survive a PUBLIC revoke and anon keeps calling. It
-- has to be named. Verified on the live project: proacl afterwards is
-- {postgres, authenticated, service_role} with no anon.
--
-- The is_account_member() guard is the second line either way — anon has
-- no auth.uid(), so it returns no rows — but the grant is the boundary.
REVOKE EXECUTE ON FUNCTION unmapped_portal_ads(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION unmapped_portal_ads(UUID) TO authenticated, service_role;
