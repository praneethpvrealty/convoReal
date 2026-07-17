-- ============================================================
-- 136_token_safe.sql — deal rooms + optional token-money escrow.
--
-- Phase 4 of the Owners Den. When a bid is ACCEPTED, a deal room
-- opens for the two parties (owner ↔ bidding agency/buyer): meeting
-- scheduling, the agreed figure, and — optionally, per deal — "Token
-- Safe" for the Indian-market token payment (bayana) that blocks the
-- property after the owner meeting.
--
-- Token Safe is real money (lakhs), NOT platform credits. The
-- platform NEVER holds funds: escrow sits with a licensed partner
-- (Escrowpay / Castler / bank escrow APIs) integrated through the
-- provider adapter (src/lib/den/token-safe.ts). Until a partner is
-- wired, two record-keeping providers ship:
--   * 'manual_escrow' — parties use an escrow service themselves and
--     record the reference here (state still tracked + confirmed
--     both ways)
--   * 'direct'        — plain UPI/cheque token with an in-app receipt
--     both parties confirm (paper trail for the classic flow)
-- Either side may always decline — Token Safe is opt-in per deal.
-- ============================================================

CREATE TABLE IF NOT EXISTS deal_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One room per accepted bid.
  bid_id UUID NOT NULL UNIQUE REFERENCES property_bids(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  owner_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bidder_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  agreed_amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'token_secured', 'closed', 'cancelled')),
  meeting_at TIMESTAMPTZ,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_rooms_owner ON deal_rooms(owner_account_id);
CREATE INDEX IF NOT EXISTS idx_deal_rooms_bidder ON deal_rooms(bidder_account_id);

-- One ACTIVE escrow/receipt per room (partial unique below); history
-- of cancelled attempts is retained.
CREATE TABLE IF NOT EXISTS token_escrows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_room_id UUID NOT NULL REFERENCES deal_rooms(id) ON DELETE CASCADE,

  -- Minor units (paise) — token money is real ₹, never credits.
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  refund_conditions TEXT,

  provider TEXT NOT NULL DEFAULT 'manual_escrow'
    CHECK (provider IN ('manual_escrow', 'direct', 'escrowpay', 'castler')),
  -- Partner escrow id / UTR / cheque number — the external reference.
  provider_ref TEXT,

  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'accepted', 'funded', 'released', 'refunded', 'disputed', 'cancelled')),
  proposed_by TEXT NOT NULL CHECK (proposed_by IN ('owner', 'bidder')),

  -- Mutual release confirmation (agreement-to-sell signed).
  owner_confirmed_at TIMESTAMPTZ,
  bidder_confirmed_at TIMESTAMPTZ,

  funded_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  -- Signature-verified partner webhook payloads, appended in order.
  webhook_log JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_escrows_room ON token_escrows(deal_room_id);
CREATE INDEX IF NOT EXISTS idx_token_escrows_provider_ref ON token_escrows(provider_ref)
  WHERE provider_ref IS NOT NULL;
-- Only one live escrow per room at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_token_escrows_one_active
  ON token_escrows(deal_room_id)
  WHERE status IN ('proposed', 'accepted', 'funded', 'disputed');

ALTER TABLE deal_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_escrows ENABLE ROW LEVEL SECURITY;

-- Both agencies read their rooms; Den owners read via /api/den
-- (service role). Writes are service-role only — the state machine
-- lives in the API layer.
DROP POLICY IF EXISTS deal_rooms_select ON deal_rooms;
CREATE POLICY deal_rooms_select ON deal_rooms
  FOR SELECT USING (
    is_account_member(owner_account_id) OR is_account_member(bidder_account_id)
  );

DROP POLICY IF EXISTS token_escrows_select ON token_escrows;
CREATE POLICY token_escrows_select ON token_escrows
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM deal_rooms r
      WHERE r.id = token_escrows.deal_room_id
        AND (is_account_member(r.owner_account_id) OR is_account_member(r.bidder_account_id))
    )
  );
