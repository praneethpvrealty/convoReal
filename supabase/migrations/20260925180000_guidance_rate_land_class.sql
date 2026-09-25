-- Agricultural guidance values are printed per land class (dry, wet,
-- garden, plantation). The class is kept beside the rate so a lookup can
-- say which column a figure came from.

ALTER TABLE guidance_value_rates
  ADD COLUMN IF NOT EXISTS land_class TEXT
  CHECK (land_class IN ('dry', 'wet', 'garden', 'plantation'));
