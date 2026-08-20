ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS salutation TEXT
  CHECK (salutation IN ('Mr.', 'Mrs.'));

COMMENT ON COLUMN public.contacts.salutation IS
  'Client-facing honorific selected by the agency. Never infer this from a name.';
