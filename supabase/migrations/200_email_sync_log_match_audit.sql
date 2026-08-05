-- ============================================================
-- 200_email_sync_log_match_audit.sql
--
-- Makes a portal lead's property match auditable after the fact.
--
-- When a Housing/MagicBricks/99acres lead is matched to the wrong
-- listing, nothing in the database says what the buyer actually asked
-- for: body_preview held 200 characters of HTML doctype header, and
-- the parsed enquiry (type, locality, size, price) was used for
-- scoring and then dropped. Re-checking a match meant going back to
-- the mailbox.
--
-- These columns record the parsed enquiry alongside the listing the
-- scorer picked and the score it won with, so a mismatch can be
-- spotted — and the correct listing found — from the log alone.
-- ============================================================

ALTER TABLE email_sync_logs
  ADD COLUMN IF NOT EXISTS parsed_property_type TEXT,
  ADD COLUMN IF NOT EXISTS parsed_location TEXT,
  ADD COLUMN IF NOT EXISTS parsed_area_sqft NUMERIC,
  ADD COLUMN IF NOT EXISTS parsed_price NUMERIC,
  ADD COLUMN IF NOT EXISTS parsed_bedrooms INTEGER,
  -- Not NOT NULL: most logs are failures or non-lead mail with no match.
  ADD COLUMN IF NOT EXISTS matched_property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_score INTEGER;

COMMENT ON COLUMN email_sync_logs.parsed_property_type IS
  'Property type parsed from the lead email, as fed to the matcher in src/app/api/leads/email-webhook/route.ts.';
COMMENT ON COLUMN email_sync_logs.parsed_location IS
  'Locality parsed from the lead email. NULL means the email carried none the parser could use.';
COMMENT ON COLUMN email_sync_logs.matched_property_id IS
  'The listing the scorer ranked first and wrote to contacts.last_inquired_property_id.';
COMMENT ON COLUMN email_sync_logs.match_score IS
  'Winning score. A low score (2-3) on a lead whose parsed locality is NULL is the shape of a coincidental match.';

-- Reviewing mismatches means scanning recent leads that produced a
-- match, newest first.
CREATE INDEX IF NOT EXISTS idx_email_sync_logs_matched_property
  ON email_sync_logs (matched_property_id, created_at DESC)
  WHERE matched_property_id IS NOT NULL;
