-- ============================================================
-- 026_add_contact_real_estate_preferences.sql
-- Adds real estate preferences to contacts: budget, areas, and interests.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS min_budget NUMERIC,
  ADD COLUMN IF NOT EXISTS max_budget NUMERIC,
  ADD COLUMN IF NOT EXISTS no_budget BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS areas_of_interest TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS property_interests TEXT[] DEFAULT '{}';
