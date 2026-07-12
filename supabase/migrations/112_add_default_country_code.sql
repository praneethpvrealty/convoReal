-- Add default_country_code to showcase_settings table
ALTER TABLE showcase_settings ADD COLUMN IF NOT EXISTS default_country_code TEXT DEFAULT '91';
