-- Migration 070: Add WhatsApp Sandbox routing columns and sender mappings table
-- Enables the shared sandbox number to route inbound messages to the correct tenant
-- based on unique hashtag prefix codes.

-- Add sandbox_code column to whatsapp_config for tenant identification
ALTER TABLE public.whatsapp_config
ADD COLUMN IF NOT EXISTS sandbox_code TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS sandbox_message_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS sandbox_message_limit INTEGER NOT NULL DEFAULT 50;

-- Create index for fast sandbox code lookups
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_sandbox_code 
ON public.whatsapp_config(sandbox_code) 
WHERE sandbox_code IS NOT NULL;

-- Create sandbox_sender_mappings table for phone -> account routing
CREATE TABLE IF NOT EXISTS public.sandbox_sender_mappings (
  sender_phone TEXT PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  sandbox_code TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.sandbox_sender_mappings ENABLE ROW LEVEL SECURITY;

-- Policy: tenants can view mappings for their own account
DROP POLICY IF EXISTS "Account members can view own sandbox mappings" ON public.sandbox_sender_mappings;
CREATE POLICY "Account members can view own sandbox mappings"
  ON public.sandbox_sender_mappings
  FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM public.profiles 
      WHERE profiles.user_id = auth.uid()
    )
  );

-- Index for fast phone lookups
CREATE INDEX IF NOT EXISTS idx_sandbox_mappings_account 
ON public.sandbox_sender_mappings(account_id);

CREATE INDEX IF NOT EXISTS idx_sandbox_mappings_phone 
ON public.sandbox_sender_mappings(sender_phone);

-- Function to generate unique sandbox codes
CREATE OR REPLACE FUNCTION generate_sandbox_code()
RETURNS TEXT AS $$
DECLARE
  code TEXT;
  exists_check BOOLEAN;
BEGIN
  LOOP
    -- Generate random code: convo + 3 digits (e.g., convo473)
    code := 'convo' || LPAD(FLOOR(RANDOM() * 1000)::TEXT, 3, '0');
    
    -- Check uniqueness
    SELECT EXISTS(
      SELECT 1 FROM public.whatsapp_config WHERE sandbox_code = code
    ) INTO exists_check;
    
    EXIT WHEN NOT exists_check;
  END LOOP;
  
  RETURN code;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate sandbox_code when integration_type is set to sandbox
CREATE OR REPLACE FUNCTION auto_generate_sandbox_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.integration_type = 'sandbox' AND NEW.sandbox_code IS NULL THEN
    NEW.sandbox_code := generate_sandbox_code();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_auto_generate_sandbox_code
BEFORE INSERT OR UPDATE OF integration_type ON public.whatsapp_config
FOR EACH ROW
EXECUTE FUNCTION auto_generate_sandbox_code();

-- Update existing sandbox configs with codes
UPDATE public.whatsapp_config 
SET sandbox_code = generate_sandbox_code()
WHERE integration_type = 'sandbox' AND sandbox_code IS NULL;

-- Seed system_settings for sandbox if not exists
INSERT INTO public.system_settings (key, value)
VALUES ('sandbox_config', '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- System templates for sandbox 24h window fallback
CREATE TABLE IF NOT EXISTS public.sandbox_system_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  language TEXT NOT NULL DEFAULT 'en',
  category TEXT NOT NULL DEFAULT 'UTILITY',
  body TEXT NOT NULL,
  header_type TEXT,
  header_text TEXT,
  footer TEXT,
  buttons JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on system templates (all authenticated users can read; only super_admin can modify)
ALTER TABLE public.sandbox_system_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to all authenticated users" ON public.sandbox_system_templates;
CREATE POLICY "Allow read access to all authenticated users"
  ON public.sandbox_system_templates
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Super admins can manage system templates" ON public.sandbox_system_templates;
CREATE POLICY "Super admins can manage system templates"
  ON public.sandbox_system_templates
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE profiles.user_id = auth.uid() 
      AND profiles.role = 'super_admin'
    )
  );

-- Seed default sandbox templates
INSERT INTO public.sandbox_system_templates (name, language, category, body, header_type, header_text, footer, buttons)
VALUES 
  ('sandbox_follow_up', 'en', 'UTILITY', 
   'Hi {{1}}, following up on your message. How can we help you today?', 
   'TEXT', 'Follow-up', 'Reply to continue chatting',
    '[{"type": "QUICK_REPLY", "text": "I''m interested"}, {"type": "QUICK_REPLY", "text": "Schedule a visit"}, {"type": "QUICK_REPLY", "text": "Get more info"}]'::jsonb)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.sandbox_system_templates (name, language, category, body, header_type, header_text, footer, buttons)
VALUES 
  ('sandbox_property_info', 'en', 'UTILITY', 
   'Hi {{1}}, here is the information about the property you inquired about. Please let us know if you have any questions.', 
   'TEXT', 'Property Details', 'Reply for more details',
   '[]'::jsonb)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.sandbox_system_templates (name, language, category, body, header_type, header_text, footer, buttons)
VALUES 
  ('sandbox_appointment_reminder', 'en', 'UTILITY', 
   'Hi {{1}}, this is a reminder about your scheduled visit. We look forward to seeing you!', 
   'TEXT', 'Visit Reminder', 'Reply to reschedule',
   '[{"type": "QUICK_REPLY", "text": "Confirm"}, {"type": "QUICK_REPLY", "text": "Reschedule"}]'::jsonb)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.sandbox_system_templates (name, language, category, body, header_type, header_text, footer, buttons)
VALUES 
  ('sandbox_general_reply', 'en', 'UTILITY', 
   'Hi {{1}}, thank you for reaching out. Our team will assist you shortly.', 
   'TEXT', 'Message Received', 'Reply to continue',
   '[]'::jsonb)
ON CONFLICT (name) DO NOTHING;
