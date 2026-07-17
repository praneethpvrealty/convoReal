-- ============================================================
-- 135_property_bids.sql — Owners Den bids/offers.
--
-- Phase 3: after unlocking a Deal Mode property (den_match_unlocks),
-- a buyer/agent account can place a bid. Bids are FREE — the unlock
-- fee is the skin-in-the-game (Indian-market decision: money before
-- conversation suppresses liquidity; the trust product is the
-- optional post-acceptance Token Safe escrow, Phase 4). Anti-spam =
-- the unlock paywall + per-account rate limits + the owner's optional
-- min_bid floor.
--
-- Bid lifecycle (all transitions via service-role API routes):
--   pending   → accepted | rejected | countered | withdrawn | expired
--   countered → accepted (buyer takes the counter) | withdrawn |
--               rejected | expired
-- Contact details are mutually revealed only on ACCEPT.
-- ============================================================

-- The owner's optional floor: bids below it are refused at the API.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS min_bid NUMERIC;

CREATE TABLE IF NOT EXISTS property_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  -- Denormalized owning tenant for cheap owner-side queries.
  owner_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bidder_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bidder_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The buyer the agency is bidding for, when there is one.
  bidder_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  -- Bids only exist after a paid unlock.
  unlock_id UUID NOT NULL REFERENCES den_match_unlocks(id) ON DELETE CASCADE,

  amount NUMERIC NOT NULL CHECK (amount > 0),
  bid_type TEXT NOT NULL DEFAULT 'sale' CHECK (bid_type IN ('sale', 'rent')),
  message TEXT,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'countered', 'withdrawn', 'expired')),
  counter_amount NUMERIC CHECK (counter_amount IS NULL OR counter_amount > 0),
  counter_message TEXT,

  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_property_bids_property
  ON property_bids(property_id, status);
CREATE INDEX IF NOT EXISTS idx_property_bids_bidder
  ON property_bids(bidder_account_id, status);
CREATE INDEX IF NOT EXISTS idx_property_bids_owner
  ON property_bids(owner_account_id, status);
-- Expiry sweep only touches live bids.
CREATE INDEX IF NOT EXISTS idx_property_bids_expiry
  ON property_bids(expires_at)
  WHERE status IN ('pending', 'countered');

-- Full audit trail — every transition appends one row.
CREATE TABLE IF NOT EXISTS property_bid_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id UUID NOT NULL REFERENCES property_bids(id) ON DELETE CASCADE,
  actor TEXT NOT NULL CHECK (actor IN ('owner', 'bidder', 'system')),
  event TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_bid_events_bid
  ON property_bid_events(bid_id, created_at);

ALTER TABLE property_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_bid_events ENABLE ROW LEVEL SECURITY;

-- Bidder-side staff read their own account's bids; the property's
-- managing agency reads bids on their inventory. Den owners read
-- through /api/den/bids (service role). All WRITES are service-role
-- only — no member insert/update policies, transitions must go
-- through the API's state machine.
DROP POLICY IF EXISTS property_bids_select ON property_bids;
CREATE POLICY property_bids_select ON property_bids
  FOR SELECT USING (
    is_account_member(bidder_account_id) OR is_account_member(owner_account_id)
  );

DROP POLICY IF EXISTS property_bid_events_select ON property_bid_events;
CREATE POLICY property_bid_events_select ON property_bid_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM property_bids b
      WHERE b.id = property_bid_events.bid_id
        AND (is_account_member(b.bidder_account_id) OR is_account_member(b.owner_account_id))
    )
  );
