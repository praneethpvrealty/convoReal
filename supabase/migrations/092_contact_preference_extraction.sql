-- ============================================================
-- 092_contact_preference_extraction.sql
--
-- AI-extracted structured buyer preferences on contacts, used by
-- the property→contact matching engine (src/lib/matching.ts).
--
-- The explicit user-entered fields (min_budget, max_budget,
-- areas_of_interest, property_interests, min_roi) remain the
-- source of truth and always win; the pref_* columns hold what
-- Gemini extracted from requirements/notes free text and fill
-- the gaps. pref_source_hash lets the extractor skip contacts
-- whose requirements/notes haven't changed since last run.
-- ============================================================

ALTER TABLE contacts
  -- Canonical property type values, same enum as properties.type
  -- (e.g. 'Flat/ Apartment', 'Residential House', 'Commercial Shop').
  ADD COLUMN IF NOT EXISTS pref_property_types TEXT[],
  -- Broad categories when only a category was stated
  -- ('residential', 'commercial', 'industrial', 'agricultural', 'plot').
  ADD COLUMN IF NOT EXISTS pref_property_categories TEXT[],
  ADD COLUMN IF NOT EXISTS pref_bhk_min INT,
  ADD COLUMN IF NOT EXISTS pref_bhk_max INT,
  ADD COLUMN IF NOT EXISTS pref_budget_min NUMERIC,
  ADD COLUMN IF NOT EXISTS pref_budget_max NUMERIC,
  ADD COLUMN IF NOT EXISTS pref_areas TEXT[],
  ADD COLUMN IF NOT EXISTS pref_excluded_areas TEXT[],
  ADD COLUMN IF NOT EXISTS pref_min_roi NUMERIC,
  ADD COLUMN IF NOT EXISTS pref_source_hash TEXT,
  ADD COLUMN IF NOT EXISTS pref_extracted_at TIMESTAMPTZ;

COMMENT ON COLUMN contacts.pref_property_types IS
  'AI-extracted preferred property types (canonical properties.type values) from requirements/notes.';
COMMENT ON COLUMN contacts.pref_property_categories IS
  'AI-extracted broad category interests when no specific type was stated: residential | commercial | industrial | agricultural | plot.';
COMMENT ON COLUMN contacts.pref_source_hash IS
  'Hash of the requirements+notes text the pref_* fields were extracted from; extraction is skipped while unchanged.';
