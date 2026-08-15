-- ============================================================
-- 283_occasion_greetings.sql
--
-- Occasion greetings: an agency composes (or AI-generates) one
-- festival/occasion greeting — message text plus an optional card
-- image — and broadcasts it to clients on the shared
-- `occasion_greeting` WhatsApp template. Each row is the reusable
-- draft; the actual fan-out is a normal `broadcasts` row, so
-- delivery tracking, retry and the sweep cron are inherited rather
-- than re-implemented. `broadcast_id` links the greeting to its
-- latest send for the stats screen.
--
-- `broadcasts.header_media_url` is new: the dispatcher previously
-- had no way to attach a header image to a campaign, and the
-- greeting card rides in the template's IMAGE header. It is a
-- resolved public URL (not a bucket path) because the send builder
-- passes it to Meta verbatim.
--
-- The `greetings` bucket is public on purpose: Meta downloads the
-- header image from this URL when each message is sent.
-- ============================================================

CREATE TABLE IF NOT EXISTS occasion_greetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  occasion_id TEXT,
  occasion_label TEXT NOT NULL,
  message_text TEXT NOT NULL,
  image_path TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  broadcast_id UUID REFERENCES broadcasts(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_occasion_greetings_account
  ON occasion_greetings(account_id, created_at DESC);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON occasion_greetings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE occasion_greetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY occasion_greetings_select ON occasion_greetings FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY occasion_greetings_insert ON occasion_greetings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY occasion_greetings_update ON occasion_greetings FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY occasion_greetings_delete ON occasion_greetings FOR DELETE
  USING (is_account_member(account_id, 'agent'));

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS header_media_url TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'greetings',
  'greetings',
  TRUE,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
