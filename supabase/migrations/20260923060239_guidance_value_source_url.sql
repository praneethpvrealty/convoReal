-- Where an imported notification was downloaded from, so the admin import
-- list can mark PDFs that are already loaded. NULL for a manual upload.
ALTER TABLE guidance_value_sources ADD COLUMN IF NOT EXISTS source_url TEXT;

CREATE INDEX IF NOT EXISTS idx_guidance_value_sources_source_url
  ON guidance_value_sources (source_url)
  WHERE source_url IS NOT NULL;
