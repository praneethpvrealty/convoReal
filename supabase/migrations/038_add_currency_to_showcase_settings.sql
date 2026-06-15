-- ============================================================
-- 038_add_currency_to_showcase_settings.sql — Add currency column to showcase_settings table
-- ============================================================

ALTER TABLE showcase_settings 
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR';
