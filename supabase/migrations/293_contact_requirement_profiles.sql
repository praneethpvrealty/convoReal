ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS requirement_profiles JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_requirement_profiles_array;

ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_requirement_profiles_array
  CHECK (jsonb_typeof(requirement_profiles) = 'array');

COMMENT ON COLUMN public.contacts.requirement_profiles IS
  'Independent active buyer briefs captured from personal WhatsApp or other external conversations. Each profile is matched separately so one requirement cannot overwrite or cross-mix another.';
