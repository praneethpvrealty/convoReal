-- Migration 068: Add WhatsApp Trial configuration tracking
-- Adds integration_type and trial_ends_at to whatsapp_config
-- and sets up a trigger to automatically calculate trial expiry based on type.

ALTER TABLE public.whatsapp_config 
ADD COLUMN IF NOT EXISTS integration_type TEXT NOT NULL DEFAULT 'sandbox'
CHECK (integration_type IN ('sandbox', 'web_qr', 'official_api')),
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- Helper to set trial_ends_at automatically upon onboarding type creation
CREATE OR REPLACE FUNCTION set_whatsapp_trial_period()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.integration_type = 'sandbox' THEN
    NEW.trial_ends_at := NOW() + INTERVAL '7 days';
  ELSIF NEW.integration_type = 'web_qr' THEN
    NEW.trial_ends_at := NOW() + INTERVAL '2 days';
  ELSIF NEW.integration_type = 'official_api' THEN
    NEW.trial_ends_at := NULL; -- Unlimited
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_set_whatsapp_trial_period
BEFORE INSERT OR UPDATE OF integration_type ON public.whatsapp_config
FOR EACH ROW
EXECUTE FUNCTION set_whatsapp_trial_period();
