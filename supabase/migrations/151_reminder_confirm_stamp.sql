-- ============================================================
-- 151_reminder_confirm_stamp.sql — record "Fine" reminder taps.
--
-- Companion to 141 (reschedule_requested_at). The reminder's "Fine"
-- quick-reply used to fall through as an ordinary inbound message:
-- nothing was recorded, the client got no acknowledgment, and for
-- owner-phone senders the message leaked into the AI ingestion
-- chatbot, which replied with its welcome text. The webhook now
-- stamps this column, acks the client, and pings the agent instead.
-- Cleared when the appointment time changes or the client later
-- requests a reschedule.
-- ============================================================

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS client_confirmed_at TIMESTAMPTZ;

COMMENT ON COLUMN appointments.client_confirmed_at IS
  'When the client tapped "Fine" on a WhatsApp reminder. Cleared on time change or reschedule request.';
