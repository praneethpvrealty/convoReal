-- ============================================================
-- 277_reminder_audio.sql — appointment reminders as voice notes.
--
-- The whatsapp_audio half of reminder delivery: contacts who chose
-- audio updates get their reminder spoken (Sarvam TTS on the queue
-- worker) and sent as a WhatsApp voice note when their 24-hour
-- window is open. TTS costs credits, so the account opts in from
-- the same Settings → WhatsApp → Voice card as reminder calls.
-- ============================================================

ALTER TABLE voice_agent_config
  ADD COLUMN IF NOT EXISTS reminder_audio_enabled BOOLEAN NOT NULL DEFAULT FALSE;
