CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS copilot_search_text TEXT
  GENERATED ALWAYS AS (
    lower(
      coalesce(property_code, '') || ' ' ||
      coalesce(title, '') || ' ' ||
      coalesce(location, '') || ' ' ||
      coalesce(sublocality, '') || ' ' ||
      coalesce(city, '') || ' ' ||
      coalesce(project, '') || ' ' ||
      coalesce(type, '') || ' ' ||
      coalesce(listing_type, '') || ' ' ||
      coalesce(tags_text, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS properties_copilot_search_idx
  ON public.properties
  USING gin (copilot_search_text extensions.gin_trgm_ops);

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS copilot_search_text TEXT
  GENERATED ALWAYS AS (
    lower(
      coalesce(name, '') || ' ' ||
      coalesce(second_name, '') || ' ' ||
      coalesce(name_tag, '') || ' ' ||
      coalesce(company, '') || ' ' ||
      coalesce(classification, '') || ' ' ||
      right(coalesce(phone, ''), 4)
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS contacts_copilot_search_idx
  ON public.contacts
  USING gin (copilot_search_text extensions.gin_trgm_ops);

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS copilot_search_text TEXT
  GENERATED ALWAYS AS (
    lower(
      coalesce(title, '') || ' ' ||
      coalesce(location, '') || ' ' ||
      coalesce(event_type, '') || ' ' ||
      coalesce(status, '') || ' ' ||
      coalesce(description, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS appointments_copilot_search_idx
  ON public.appointments
  USING gin (copilot_search_text extensions.gin_trgm_ops);
