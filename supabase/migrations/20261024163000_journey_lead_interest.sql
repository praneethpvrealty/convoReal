-- ============================================================
-- 20261024163000_journey_lead_interest.sql
--
-- A lead's own yes on a listing — the 👍 Interested tap on a bot
-- listing card, the ⭐ Shortlist tap, a Book a visit / Call me back
-- answer to a showcase check-in — was filed on listing_feedback and
-- property_likes and surfaced nowhere a brokerage could read it as a
-- list: the Journey tab's Captured tray carried the bot's share with no
-- sign the lead answered, the item sheet knew nothing, and the Helper's
-- interest function never read listing_feedback at all. This stamps the
-- signal on the contact×property journey item so the Journey tab is the
-- one place that lists who said yes to what. Additive: two nullable
-- columns and a partial index; the backfill and the functions that read
-- them follow in 20261024163100_journey_lead_interest_signals.sql.
-- ============================================================

ALTER TABLE journey_items
  ADD COLUMN IF NOT EXISTS lead_interest TEXT
    CHECK (lead_interest IN ('interested', 'shortlisted')),
  ADD COLUMN IF NOT EXISTS lead_interest_at TIMESTAMPTZ;

COMMENT ON COLUMN journey_items.lead_interest IS
  'The strongest yes the lead gave on this listing themselves: interested (Interested tap or showcase check-in visit/call) outranks shortlisted (Shortlist tap). Never set by staff.';
COMMENT ON COLUMN journey_items.lead_interest_at IS
  'When the lead last gave that yes.';

CREATE INDEX IF NOT EXISTS idx_journey_items_lead_interest
  ON journey_items (account_id, lead_interest_at DESC)
  WHERE lead_interest IS NOT NULL;
