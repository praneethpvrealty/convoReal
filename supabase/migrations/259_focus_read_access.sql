-- ============================================================
-- 259_focus_read_access.sql — let the team read the two inbound-request
-- sources the Focus screen ranks.
--
-- Focus answers "what should I act on next?" from three request
-- sources: property inquiries, Match Radar events, and pending
-- listing submissions / Den bids. Radar events and bids already grant
-- SELECT to account members. The other two do not:
--
--   contact_property_inquiries (062) predates the account model. It
--   carries no account_id and its only policy reaches through to
--   contacts.user_id = auth.uid(), so a portal inquiry is visible to
--   exactly one member — whoever owns the contact row — and invisible
--   to the rest of the team. (src/app/api/contacts/merge already
--   writes an account_id to it, against a column that was never
--   added.)
--
--   public_listing_submissions (100) enables RLS and then defines no
--   policy at all, so only the service role can read it. The seller
--   who submitted a listing is waiting on a member of the account
--   the submission was addressed to.
--
-- account_id on the inquiries table stays NULLABLE on purpose. A NOT
-- NULL on a legacy table turns any writer this change failed to update
-- into a hard insert failure on the lead-ingestion path; nullable
-- degrades to "the row is still readable through the legacy policy"
-- instead. The backfill below leaves no NULLs behind, and every known
-- writer is updated in the same change.
-- ============================================================

ALTER TABLE contact_property_inquiries
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

COMMENT ON COLUMN contact_property_inquiries.account_id IS
  'Owning tenant, denormalised from contacts.account_id. Nullable only so pre-259 rows written by an un-updated path stay insertable; every writer sets it.';

UPDATE contact_property_inquiries AS cpi
SET account_id = c.account_id
FROM contacts AS c
WHERE c.id = cpi.contact_id
  AND cpi.account_id IS DISTINCT FROM c.account_id;

CREATE INDEX IF NOT EXISTS idx_cpi_account_date
  ON contact_property_inquiries (account_id, inquiry_date DESC);

-- Membership-based access, alongside the legacy owner policy that
-- migration 062 installed. Postgres ORs permissive policies together,
-- so this widens reads to the whole team without narrowing anything
-- that worked before.
DROP POLICY IF EXISTS "Account members can manage contact property inquiries" ON contact_property_inquiries;
CREATE POLICY "Account members can manage contact property inquiries" ON contact_property_inquiries FOR ALL
  USING (account_id IS NOT NULL AND is_account_member(account_id))
  WITH CHECK (account_id IS NOT NULL AND is_account_member(account_id));

-- Read-only for members. Every write still goes through the public
-- intake and verification routes on the service-role client, so the
-- code → WhatsApp → verified-property state machine stays the only
-- way a submission can change.
DROP POLICY IF EXISTS public_listing_submissions_select ON public_listing_submissions;
CREATE POLICY public_listing_submissions_select ON public_listing_submissions
  FOR SELECT USING (is_account_member(account_id));
