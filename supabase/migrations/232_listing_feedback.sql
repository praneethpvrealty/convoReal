-- ============================================================
-- 232_listing_feedback.sql
--
-- Listing feedback: a contact's explicit verdict on a listing the
-- Engine showed them — interested, or rejected (optionally with a
-- one-tap reason). Unlike property_likes (anonymous showcase
-- sentiment keyed by device), this is a named contact training
-- their own match feed, so it is keyed by (contact, property) and
-- the latest verdict wins.
--
-- Written only by service-role webhook handlers (the WhatsApp
-- feedback prompt); read by account staff. Rankings exclude a
-- contact's rejected properties so the engine never re-offers what
-- they turned down.
-- ============================================================

CREATE TABLE IF NOT EXISTS listing_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('interested', 'rejected')),
  -- One-tap reason offered after a rejection; null when not given.
  reason TEXT CHECK (reason IN ('budget', 'location', 'type', 'size', 'other')),
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(contact_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_listing_feedback_contact
  ON listing_feedback (account_id, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_feedback_property
  ON listing_feedback (property_id, verdict);

ALTER TABLE listing_feedback ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_listing_feedback_updated_at ON listing_feedback;
CREATE TRIGGER set_listing_feedback_updated_at BEFORE UPDATE ON listing_feedback
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Staff read the feedback on their own account's listings; writes come
-- only from the service-role webhook path (no client INSERT policy).
DROP POLICY IF EXISTS listing_feedback_select ON listing_feedback;
CREATE POLICY listing_feedback_select ON listing_feedback FOR SELECT USING (
  is_account_member(account_id)
);
