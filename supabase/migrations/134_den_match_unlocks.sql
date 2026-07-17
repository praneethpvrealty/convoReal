-- ============================================================
-- 134_den_match_unlocks.sql — Deal Mode matching feed + paid unlock.
--
-- Phase 2 of the Owners Den: properties with deal_mode on enter a
-- CROSS-TENANT matching pool. The sweep (src/lib/den/matching-sweep.ts,
-- cron /api/cron/deal-mode-matching) matches them against every OTHER
-- tenant's Buyer/Agent contacts and records the result as a
-- match_events row in the BUYER's account — reusing the Match Radar
-- feed instead of a parallel table.
--
-- Cross-tenant safety: the event row lives in the buyer's account and
-- its RLS (is_account_member) applies as usual. The subject property
-- belongs to another tenant, so the buyer CANNOT read it through the
-- properties join — everything they may see pre-unlock ships in
-- `subject_snapshot`, a masked snapshot built by a single whitelist
-- function (src/lib/den/masking.ts): type, locality-level location,
-- price band, size. Never the address, images, title or owner.
-- ============================================================

ALTER TABLE match_events
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'internal'
    CHECK (source IN ('internal', 'deal_mode')),
  ADD COLUMN IF NOT EXISTS subject_snapshot JSONB;

-- The sweep's dedupe lookup: one live event per (buyer account,
-- deal-mode property).
CREATE INDEX IF NOT EXISTS idx_match_events_deal_mode
  ON match_events (account_id, property_id, created_at DESC)
  WHERE source = 'deal_mode';

-- ============================================================
-- den_match_unlocks — the paid reveal. One unlock per (buyer account,
-- property): the whole agency benefits once anyone in it pays. The
-- UNIQUE constraint is the double-billing backstop (the API refunds
-- and returns the existing row on 23505).
-- ============================================================

CREATE TABLE IF NOT EXISTS den_match_unlocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The paying (buyer/agent) tenant — NOT the property's tenant.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unlocked_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  match_event_id UUID REFERENCES match_events(id) ON DELETE SET NULL,
  -- Best matching score at unlock time (informational).
  score INT,
  credits_burned INT NOT NULL,
  retry_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (account_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_den_match_unlocks_property
  ON den_match_unlocks(property_id);

ALTER TABLE den_match_unlocks ENABLE ROW LEVEL SECURITY;

-- Members of the paying account can see their unlocks; all writes go
-- through the service-role API route (burn + insert must stay coupled).
DROP POLICY IF EXISTS den_match_unlocks_select ON den_match_unlocks;
CREATE POLICY den_match_unlocks_select ON den_match_unlocks
  FOR SELECT USING (is_account_member(account_id));
