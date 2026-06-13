-- ============================================================
-- 034_add_property_google_map_link.sql — Add google_map_link column to properties
-- and link contacts to their last inquired property
-- ============================================================

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS google_map_link TEXT;

-- Add last_inquired_property_id to contacts
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS last_inquired_property_id UUID REFERENCES properties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_last_inquired_property ON contacts(last_inquired_property_id);
