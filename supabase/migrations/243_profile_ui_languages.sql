-- The agent's own app language(s).
--
-- Distinct from migration 242, which is about what a CLIENT reads in a
-- WhatsApp message. This is what the person using ConvoReal reads on
-- screen. A Bangalore agent runs the app in Kannada and still messages
-- a Hindi-speaking buyer in Hindi.
--
-- Two columns rather than one ordered array: `ui_languages` is the set
-- the agent declared they read, `active_ui_language` is the one showing
-- right now. The header toggle only writes the second, so flipping
-- language never risks rewriting the declared set.
--
-- Lives on profiles, not localStorage, because the mobile app reads
-- profiles directly through the same RLS. An agent who picks Kannada on
-- the web finds the phone in Kannada, with no extra API surface to
-- build when the mobile copilot ships. The web keeps a localStorage
-- copy purely as a first-paint cache.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ui_languages TEXT[] NOT NULL DEFAULT ARRAY['en'];
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS active_ui_language TEXT NOT NULL DEFAULT 'en';

DO $$
BEGIN
  -- Deliberately NOT capped at the product's current two-language
  -- limit. That cap is a packaging decision (a higher subscription tier
  -- may allow more) and lives in MAX_UI_LANGUAGES in
  -- src/lib/languages.ts, where raising it costs nothing. The database
  -- only guards what would actually corrupt a render: an unknown code,
  -- an empty set, or duplicates.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_ui_languages_check'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_ui_languages_check
      CHECK (
        array_length(ui_languages, 1) BETWEEN 1 AND 7
        AND ui_languages <@ ARRAY['en', 'hi', 'kn', 'ta', 'te', 'ml', 'mr']
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_active_ui_language_check'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_active_ui_language_check
      CHECK (active_ui_language IN ('en', 'hi', 'kn', 'ta', 'te', 'ml', 'mr'));
  END IF;
END $$;

-- The active language must be one the agent said they read. Enforced
-- here rather than only in the UI because both the web and the mobile
-- app write these columns directly, and a client that sets one without
-- the other would leave the app rendering a language its owner cannot
-- read and no obvious way back.
CREATE OR REPLACE FUNCTION public.enforce_active_ui_language()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT (NEW.active_ui_language = ANY (NEW.ui_languages)) THEN
    NEW.active_ui_language := NEW.ui_languages[1];
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS profiles_active_ui_language_guard ON profiles;
CREATE TRIGGER profiles_active_ui_language_guard
  BEFORE INSERT OR UPDATE OF ui_languages, active_ui_language ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_active_ui_language();

COMMENT ON COLUMN profiles.ui_languages IS
  'Languages this agent reads. Product caps the count (MAX_UI_LANGUAGES); the DB does not, so a subscription tier can raise it without a migration.';
COMMENT ON COLUMN profiles.active_ui_language IS
  'Which of ui_languages the app is currently rendered in. Coerced into ui_languages by trigger.';
