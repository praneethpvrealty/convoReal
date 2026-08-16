-- ============================================================
-- 287_closing_deal_nudges.sql — per-deal state for the closing card.
--
-- Migration 286 took deals at legal out of the enquiry radar. Silence
-- there is not neglect, but it is not nothing either: a registration
-- slips as often as a lead goes cold, and once the enquiry card stops
-- firing nothing else watches the deal at all. The closing card is the
-- replacement watchdog — it clocks the journey item's own stage
-- movement rather than WhatsApp silence, and it offers the agent the
-- next stage instead of "mark cold".
--
-- Keyed by journey item, not contact: a buyer can be closing on one
-- property while still enquiring about another, and follow_up_nudges
-- (migration 272) is keyed by contact. Sharing that row would let an
-- enquiry snooze silence a closing deal.
--
-- Written by service-role cron/webhook code; account members can read
-- their own rows. Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS closing_deal_nudges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES journey_items(id) ON DELETE CASCADE,

  last_nudged_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_closing_deal_nudges_account
  ON closing_deal_nudges (account_id, last_nudged_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON closing_deal_nudges;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON closing_deal_nudges
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE closing_deal_nudges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS closing_deal_nudges_select ON closing_deal_nudges;
CREATE POLICY closing_deal_nudges_select ON closing_deal_nudges FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS closing_deal_nudges_modify ON closing_deal_nudges;
CREATE POLICY closing_deal_nudges_modify ON closing_deal_nudges FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);
