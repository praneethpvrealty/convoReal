-- ============================================================
-- 174_buyer_match_digest.sql — buyers get their matches on WhatsApp.
--
-- The buyer twin of the owner property digest (migration 126). A buyer
-- who has told an agency what they're looking for gets the listings
-- that fit pushed to WhatsApp, ranked by the same engine that powers
-- /buyer/matches — so the portal, the agent's Radar and the chat can
-- never disagree about what a match is.
--
-- Consent-first, exactly like the owner digest: contacts
-- .buyer_alerts_consent already exists (migration 160, 'pending' |
-- 'granted' | 'declined') and the STOP/START ALERTS commands already
-- edit it. What was missing is the "asked once, still waiting" marker,
-- so a pending buyer is never asked twice.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS buyer_alerts_consent_requested_at TIMESTAMPTZ;

COMMENT ON COLUMN contacts.buyer_alerts_consent_requested_at IS
  'When we last asked this buyer to opt in to WhatsApp match alerts. Set once; a pending buyer is never re-asked.';

-- Insert-as-claim ledger: the UNIQUE row is taken BEFORE the send, so
-- a racing cron tick loses with 23505 instead of double-messaging.
-- property_ids is what went out, which is also the "don't send the same
-- listing again next week" memory — no second table needed.
CREATE TABLE IF NOT EXISTS buyer_match_digest_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  buyer_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  digest_date DATE NOT NULL,
  property_ids UUID[] NOT NULL DEFAULT '{}',
  -- 'freeform' | 'template' | 'consent_requested' | 'failed' | 'skipped_no_template'
  channel TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, buyer_contact_id, digest_date)
);

CREATE INDEX IF NOT EXISTS idx_buyer_match_digest_log_account
  ON buyer_match_digest_log(account_id, digest_date DESC);
-- The repeat-suppression read: everything sent to this buyer lately.
CREATE INDEX IF NOT EXISTS idx_buyer_match_digest_log_contact
  ON buyer_match_digest_log(buyer_contact_id, digest_date DESC);

ALTER TABLE buyer_match_digest_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS buyer_match_digest_log_select ON buyer_match_digest_log;
CREATE POLICY buyer_match_digest_log_select ON buyer_match_digest_log FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS buyer_match_digest_log_modify ON buyer_match_digest_log;
CREATE POLICY buyer_match_digest_log_modify ON buyer_match_digest_log FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

-- The digest's candidate read is "this account's active buyer contacts
-- who let us message them" — without this it scans every contact the
-- account has.
CREATE INDEX IF NOT EXISTS idx_contacts_buyer_alerts
  ON contacts(account_id, buyer_alerts_consent)
  WHERE status = 'active';
