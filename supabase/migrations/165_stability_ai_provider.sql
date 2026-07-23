-- Add Stability AI as a flyer image provider, plus a per-account model
-- choice (SD 3.5 variants / Ultra). Widens the existing provider CHECK
-- and adds flyer_stability_model.

ALTER TABLE showcase_settings
  DROP CONSTRAINT IF EXISTS showcase_settings_flyer_ai_provider_check;

ALTER TABLE showcase_settings
  ADD CONSTRAINT showcase_settings_flyer_ai_provider_check
  CHECK (flyer_ai_provider IN ('google', 'huggingface', 'stability'));

ALTER TABLE showcase_settings
  ADD COLUMN IF NOT EXISTS flyer_stability_model TEXT NOT NULL DEFAULT 'sd3.5-large'
  CHECK (flyer_stability_model IN ('sd3.5-large', 'sd3.5-large-turbo', 'sd3.5-medium', 'ultra'));
