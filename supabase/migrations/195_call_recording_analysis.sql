-- ============================================================
-- 195_call_recording_analysis.sql
-- AI analysis of phone-call recordings/transcripts on the contact
-- call journal: the uploaded recording, its transcript, an AI
-- summary with key points and action items, and a reviewable
-- WhatsApp update draft for the client (with sent bookkeeping).
--
-- Recordings are sensitive (legal/deal calls), so the bucket is
-- PRIVATE: uploads and playback both go through service-role code
-- paths (`/api/contacts/[id]/calls/[callId]/recording` issues a
-- short-lived signed URL after account-membership checks).
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'call-recordings',
  'call-recordings',
  FALSE,
  26214400, -- 25 MB
  ARRAY[
    'audio/mpeg',
    'audio/mp4',
    'audio/aac',
    'audio/ogg',
    'audio/wav',
    'audio/x-wav',
    'audio/webm',
    'audio/amr',
    'audio/3gpp',
    'audio/flac'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE contact_call_logs
  ADD COLUMN IF NOT EXISTS recording_url TEXT,
  ADD COLUMN IF NOT EXISTS transcript TEXT,
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS key_points TEXT[],
  ADD COLUMN IF NOT EXISTS action_items TEXT[],
  ADD COLUMN IF NOT EXISTS update_draft TEXT,
  ADD COLUMN IF NOT EXISTS update_sent_at TIMESTAMPTZ;

-- The table shipped without an UPDATE policy (rows were append-only).
-- Reviewing/editing the AI update draft needs one.
DROP POLICY IF EXISTS call_logs_update ON contact_call_logs;
CREATE POLICY call_logs_update
  ON contact_call_logs FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
