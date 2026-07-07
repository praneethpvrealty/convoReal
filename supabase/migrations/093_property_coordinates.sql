-- ============================================================
-- 093_property_coordinates.sql
--
-- Geographic coordinates + canonical locality identity on
-- properties, powering tiered location search ("in HSR Layout"
-- first, then nearby within a radius) in /api/properties.
--
-- Populated three ways:
--   1. Agent picks a locality from Google Places autocomplete in
--      the property form (lat/lng/place_id come with the pick).
--   2. Server-side geocode fallback on create/update when the
--      form was saved without a picked place.
--   3. One-time backfill script for existing rows
--      (src/scripts/backfill-property-coords.ts).
--
-- Distance math happens in the API layer (haversine over a
-- bounding-box-filtered query) — deliberately no PostGIS
-- dependency at current inventory scale; the index below keeps
-- the bounding-box scan cheap.
-- ============================================================

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  -- Google Places place_id of the picked locality — the canonical
  -- identity used for the exact-locality search tier.
  ADD COLUMN IF NOT EXISTS locality_place_id TEXT,
  -- Canonical locality display name from Places (e.g. "HSR Layout"),
  -- normalizing the free-text variants agents type.
  ADD COLUMN IF NOT EXISTS locality_canonical TEXT;

CREATE INDEX IF NOT EXISTS idx_properties_account_coords
  ON properties (account_id, latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_properties_account_locality_place
  ON properties (account_id, locality_place_id)
  WHERE locality_place_id IS NOT NULL;

COMMENT ON COLUMN properties.locality_place_id IS
  'Google Places place_id of the property''s locality; exact-tier key for location search.';
COMMENT ON COLUMN properties.locality_canonical IS
  'Canonical locality name from Google Places (normalizes agent-typed variants).';
