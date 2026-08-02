-- Migration 064: Add internal notes field to properties
-- Gives agents a dedicated place to store internal, location-specific notes
-- (e.g. "Near Metro Station, next to XYZ school") that are searchable but
-- not shown on the public showcase portal.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- GIN index for fast full-text search on the notes column
CREATE INDEX IF NOT EXISTS idx_properties_notes_fts
  ON properties USING gin(to_tsvector('english', coalesce(notes, '')));

-- Also index description for faster ilike queries
CREATE INDEX IF NOT EXISTS idx_properties_description_gin
  ON properties USING gin(to_tsvector('english', coalesce(description, '')));

-- Composite index for the common ilike search fields
CREATE INDEX IF NOT EXISTS idx_properties_text_search
  ON properties (account_id, location, sublocality, city);

COMMENT ON COLUMN properties.notes IS
  'Internal agent notes about the property — visible only in the Engine, never on the public portal. Useful for location landmarks, access instructions, owner details, etc.';
