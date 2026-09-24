ALTER TABLE properties ADD COLUMN IF NOT EXISTS khata_epid TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS khata_form TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS year_built SMALLINT;

DO $$
BEGIN
  ALTER TABLE properties
    ADD CONSTRAINT properties_khata_form_check CHECK (khata_form IN ('A', 'B'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE properties
    ADD CONSTRAINT properties_year_built_check CHECK (year_built BETWEEN 1800 AND 2100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN properties.khata_epid IS 'New ePID from the property''s e-Khata';
COMMENT ON COLUMN properties.khata_form IS 'e-Khata classification: A (Form-A) or B (Form-B)';
COMMENT ON COLUMN properties.year_built IS 'Year of construction, e.g. from the e-Khata floor details';
