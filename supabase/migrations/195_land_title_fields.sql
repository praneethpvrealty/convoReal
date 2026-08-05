-- Title/extent fields for raw land parcels. Ownership and land use
-- already exist (properties.ownership_status, properties.land_zone);
-- these two complete the set the land editor collects.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS legal_status TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS conversion_type TEXT;
