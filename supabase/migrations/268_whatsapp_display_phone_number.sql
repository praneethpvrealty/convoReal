-- The Engine's own WhatsApp number, as a number you can dial or link to.
--
-- whatsapp_config has only ever stored phone_number_id — Meta's opaque
-- handle. That is all the send path needs, so nothing noticed the gap;
-- but it means nothing OUTSIDE the send path can address the business
-- number. The public showcase could not, so its "I'm interested" button
-- fell back to showcase_settings.contact_phone — an agent's personal
-- mobile — and every enquiry tapped from the catalog bypassed the
-- Engine entirely: no contact, no conversation, no Radar, no learning.
-- The agent found out only if they happened to read that thread.
--
-- verifyPhoneNumber() already returns display_phone_number and the
-- config save already calls it, so this column is filled from a value
-- that was being fetched and discarded. Nullable on purpose: a sandbox
-- config has no number of its own, and an Official API config saved
-- before this migration keeps working with a null until its next save.

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS display_phone_number TEXT;

COMMENT ON COLUMN whatsapp_config.display_phone_number IS
  'E.164-ish display number from Meta (e.g. "+91 88677 09556"). Set on config save from verifyPhoneNumber(). Null for sandbox configs and for rows not re-saved since migration 268.';
