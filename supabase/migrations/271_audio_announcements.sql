-- ============================================================
-- 271_audio_announcements.sql
-- Phase D of docs/voice-agent-integration-plan.md §7:
--
-- contacts.preferred_update_channel — how this contact wants
-- updates/reminders delivered. NULL means no stated preference (the
-- sender's default applies); an explicit value always wins. Captured
-- in the contact form; consulted by announcement sends today and by
-- reminders/digests as they adopt it.
--
-- voice_announcements — a plain announcement rendered to a WhatsApp
-- voice note: the text, the target language, and the generated audio.
-- Generation runs on the queue worker (the only place Sarvam TTS +
-- ffmpeg live); the audio lands in the public `announcements` bucket
-- because Meta fetches media by public URL at send time.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS preferred_update_channel TEXT
    CHECK (preferred_update_channel IN ('whatsapp_text', 'whatsapp_audio', 'voice_call'));

CREATE TABLE IF NOT EXISTS voice_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body_text TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en-IN',
  status TEXT NOT NULL DEFAULT 'generating'
    CHECK (status IN ('generating', 'ready', 'failed')),
  audio_url TEXT,
  error TEXT,
  sent_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_announcements_account
  ON voice_announcements(account_id, created_at DESC);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON voice_announcements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE voice_announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY voice_announcements_select
  ON voice_announcements FOR SELECT
  USING (is_account_member(account_id));

CREATE POLICY voice_announcements_insert
  ON voice_announcements FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY voice_announcements_update
  ON voice_announcements FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY voice_announcements_delete
  ON voice_announcements FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- Public on purpose: Meta downloads the voice note from this URL when
-- the message is sent, exactly like listing videos in property-videos.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'announcements',
  'announcements',
  TRUE,
  10485760, -- 10 MB
  ARRAY['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
