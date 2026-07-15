-- Coordinates for areas of interest picked via Google Places autocomplete,
-- stored as [{ "name": "...", "lat": 12.9, "lng": 77.6 }] keyed by the same
-- area names as contacts.areas_of_interest. Lets proximity matching (5/20 km
-- radius) work for localities missing from the static Bangalore coordinates
-- table; areas without an entry keep falling back to that table.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS areas_of_interest_geo JSONB;
