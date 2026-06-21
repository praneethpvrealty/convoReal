-- ============================================================
-- 055_add_subdomain_to_showcase_settings.sql
-- Add subdomain to showcase_settings table with unique constraint
-- ============================================================

ALTER TABLE showcase_settings ADD COLUMN IF NOT EXISTS subdomain TEXT;

-- Enforce unique constraint on subdomain column (ignores multiple NULL values)
ALTER TABLE showcase_settings DROP CONSTRAINT IF EXISTS showcase_settings_subdomain_unique;
ALTER TABLE showcase_settings ADD CONSTRAINT showcase_settings_subdomain_unique UNIQUE (subdomain);
