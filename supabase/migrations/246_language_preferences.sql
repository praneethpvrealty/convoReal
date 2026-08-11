-- Language preferences.
--
-- Two levels, because they answer different questions:
--   accounts.default_language  — what this brokerage writes in when it
--                                knows nothing about the recipient.
--   contacts.preferred_language — what THIS person reads. Overrides the
--                                account default for every outbound send.
--
-- NULL on a contact means "not known", not "English": the send path
-- falls back to the account default, which itself defaults to English.
-- Storing an explicit 'en' therefore means an agent actively chose it.
--
-- Codes are the short keys from src/lib/languages.ts (en, hi, kn, ta,
-- te, ml, mr), NOT Meta's template codes — the mapping to those lives
-- in metaLanguageCode(). Keeping our key short and stable means a
-- change in Meta's codes never requires a data migration.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS default_language TEXT NOT NULL DEFAULT 'en';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS preferred_language TEXT;

-- Guard the vocabulary in the database too. The API validates as well,
-- but bulk import, the webhook path and manual SQL all write contacts
-- and would otherwise be free to invent a code the send path cannot map.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_default_language_check'
  ) THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_default_language_check
      CHECK (default_language IN ('en', 'hi', 'kn', 'ta', 'te', 'ml', 'mr'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_preferred_language_check'
  ) THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_preferred_language_check
      CHECK (preferred_language IS NULL
             OR preferred_language IN ('en', 'hi', 'kn', 'ta', 'te', 'ml', 'mr'));
  END IF;
END $$;

-- Broadcast and digest sends group an audience by language to pick the
-- right template variant. Partial: the null majority never needs a scan.
CREATE INDEX IF NOT EXISTS contacts_account_preferred_language_idx
  ON contacts (account_id, preferred_language)
  WHERE preferred_language IS NOT NULL;

COMMENT ON COLUMN accounts.default_language IS
  'Fallback outbound language for the account. Short code from src/lib/languages.ts.';
COMMENT ON COLUMN contacts.preferred_language IS
  'Language this contact reads. NULL = unknown, falls back to accounts.default_language.';
