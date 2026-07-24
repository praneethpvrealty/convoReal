-- Second Name: surname stored separately from the first name so two
-- different people sharing a first name stay distinguishable in the CRM.
-- Deliberately kept out of the name column so WhatsApp templates,
-- broadcasts, email and other outbound channels — which read
-- contacts.name — keep addressing the contact by first name alone.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS second_name TEXT;

-- One contact per full name per account, case-insensitively. Enforced only
-- when both names are present: webhook- and import-created contacts arrive
-- without a second name and must never fail ingestion, and existing rows
-- keep working until staff assign second names to the clashing ones.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_account_full_name_key
  ON contacts (account_id, lower(btrim(name)), lower(btrim(second_name)))
  WHERE is_merged = false
    AND name IS NOT NULL AND btrim(name) <> ''
    AND second_name IS NOT NULL AND btrim(second_name) <> '';
