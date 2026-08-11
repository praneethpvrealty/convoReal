-- ============================================================
-- 253_contacts_optional_phone.sql
-- A contact can be reachable by email alone.
--
-- Builders, channel partners and portal desks arrive as a company
-- mailbox with no number attached. Until now `contacts.phone` was
-- NOT NULL, so those records could not be stored at all and agents
-- kept them outside the Engine.
--
-- Phone becomes nullable, with a CHECK that a contact still carries
-- at least one way to reach it. Empty-string phones (never valid,
-- and impossible to message) collapse to NULL first so the new
-- constraint means what it says.
--
-- Every WhatsApp path must now skip a contact with no phone rather
-- than assume one — see src/lib/contacts/reachability.ts.
-- ============================================================

UPDATE contacts SET phone = NULL WHERE phone IS NOT NULL AND btrim(phone) = '';
UPDATE contacts SET email = NULL WHERE email IS NOT NULL AND btrim(email) = '';

ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_phone_or_email;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_phone_or_email
  CHECK (phone IS NOT NULL OR email IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_account_email
  ON contacts(account_id, lower(email))
  WHERE email IS NOT NULL;

COMMENT ON COLUMN contacts.phone IS
  'WhatsApp number in E.164. NULL for email-only records (company mailboxes); such contacts are excluded from every send path.';
