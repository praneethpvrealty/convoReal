ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS requires_tenanted BOOLEAN,
  ADD COLUMN IF NOT EXISTS pref_requires_tenanted BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.contacts.requires_tenanted IS
  'Explicit buyer constraint: only currently tenanted or pre-leased properties qualify.';

COMMENT ON COLUMN public.contacts.pref_requires_tenanted IS
  'AI-extracted buyer constraint for already rented, tenanted or pre-leased properties.';
