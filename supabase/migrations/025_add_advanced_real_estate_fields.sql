-- ============================================================
-- 025_add_advanced_real_estate_fields.sql
-- Adds advanced spec fields: area units, dimensions, road details, and nearby highlights.
-- ============================================================

ALTER TABLE properties 
  ADD COLUMN IF NOT EXISTS area_unit TEXT DEFAULT 'Sq.Ft.',
  ADD COLUMN IF NOT EXISTS land_area_unit TEXT DEFAULT 'Sq.Ft.',
  ADD COLUMN IF NOT EXISTS dimensions TEXT,
  ADD COLUMN IF NOT EXISTS road_width NUMERIC,
  ADD COLUMN IF NOT EXISTS road_width_unit TEXT DEFAULT 'Feet',
  ADD COLUMN IF NOT EXISTS facing_direction TEXT,
  ADD COLUMN IF NOT EXISTS nearby_highlights TEXT[] DEFAULT '{}';
