-- Migration 072: Allow nullable phone_number_id and access_token for Sandbox mode
-- Sandbox tenants don't have their own Meta credentials — they use the
-- system-wide shared number configured in system_settings.

ALTER TABLE public.whatsapp_config
ALTER COLUMN phone_number_id DROP NOT NULL,
ALTER COLUMN access_token DROP NOT NULL;
