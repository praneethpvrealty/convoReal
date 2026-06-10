-- ============================================================
-- 024_add_commercial_fields.sql
-- Adds land_zone and ideal_for columns to properties table
-- ============================================================

ALTER TABLE properties 
  ADD COLUMN IF NOT EXISTS land_zone TEXT,
  ADD COLUMN IF NOT EXISTS ideal_for TEXT;