-- ============================================================
-- Internal search tags on properties.
--
-- Free-text labels agents pin on a listing — a builder name
-- ("Brick and Bolt"), a campaign, a deal nickname — so it can be
-- found by fragments the structured fields don't carry. Engine-only,
-- never shown on the public showcase.
--
-- tags_text mirrors the array as one string so the PostgREST
-- ilike search in GET /api/properties can match inside tag labels
-- (array columns only support exact-element operators). Generated
-- columns require IMMUTABLE expressions and array_to_string() is
-- only STABLE, hence the wrapper.
-- ============================================================

CREATE OR REPLACE FUNCTION immutable_array_to_text(arr TEXT[])
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$ SELECT array_to_string(arr, ' ') $$;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS tags_text TEXT
  GENERATED ALWAYS AS (immutable_array_to_text(tags)) STORED;

COMMENT ON COLUMN properties.tags IS
  'Internal free-text search tags (builder, campaign, deal nickname). Engine-only — never shown on the public showcase.';
