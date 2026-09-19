-- Meta error 131049 is a per-recipient marketing frequency cap. Persist a
-- short cooldown on the contact so every outbound path can avoid hammering
-- the same recipient, and keep failure data out of the customer message body.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS whatsapp_marketing_suppressed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_marketing_suppression_code INTEGER;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS error_code INTEGER,
  ADD COLUMN IF NOT EXISTS error_info TEXT,
  ADD COLUMN IF NOT EXISTS retry_after TIMESTAMPTZ;

COMMENT ON COLUMN public.contacts.whatsapp_marketing_suppressed_until IS
  'Marketing-template cooldown after Meta error 131049; cleared by an inbound message.';
COMMENT ON COLUMN public.messages.error_code IS
  'Meta delivery error code, stored separately from content_text.';
COMMENT ON COLUMN public.messages.retry_after IS
  'Earliest safe manual retry time for a temporary delivery failure.';
