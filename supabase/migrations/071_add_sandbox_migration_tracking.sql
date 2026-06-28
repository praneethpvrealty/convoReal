-- Migration 071: Add sandbox migration tracking columns
-- Tracks when a tenant upgraded from sandbox to official API

ALTER TABLE public.whatsapp_config
ADD COLUMN IF NOT EXISTS migrated_from_sandbox_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS migrated_sandbox_code TEXT;

-- Add index for migration tracking queries
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_migrated 
ON public.whatsapp_config(migrated_from_sandbox_at) 
WHERE migrated_from_sandbox_at IS NOT NULL;

-- Update trigger: when integration_type changes FROM sandbox TO official_api,
-- automatically record the migration timestamp and preserve the code
CREATE OR REPLACE FUNCTION track_sandbox_migration()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.integration_type = 'sandbox' AND NEW.integration_type = 'official_api' THEN
    NEW.migrated_from_sandbox_at := NOW();
    NEW.migrated_sandbox_code := OLD.sandbox_code;
    -- Clear sandbox-specific fields that are no longer needed
    NEW.sandbox_message_count := 0;
    NEW.trial_ends_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_track_sandbox_migration ON public.whatsapp_config;
CREATE TRIGGER trigger_track_sandbox_migration
BEFORE UPDATE OF integration_type ON public.whatsapp_config
FOR EACH ROW
EXECUTE FUNCTION track_sandbox_migration();
