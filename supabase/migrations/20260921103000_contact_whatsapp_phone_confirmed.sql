-- When a contact has more than one number, the WhatsApp action asks which
-- one to message. The answer becomes the primary phone and is recorded
-- here, so the question is asked once per contact and never again.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS whatsapp_phone_confirmed_at TIMESTAMPTZ;
