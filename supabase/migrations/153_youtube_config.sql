-- ============================================================
-- 153_youtube_config.sql — per-account YouTube channel connection
--   + unlisted YouTube copies of listing videos.
--
-- One row per account, mirroring meta_ads_config's shape: an
-- encrypted Google OAuth refresh token (AES-GCM via
-- src/lib/whatsapp/encryption.ts) plus the channel the owner picked
-- to receive listing-video uploads. Written and read only by the
-- /api/youtube/* routes and the queue worker via the service-role
-- client (same stance as meta_ads_config — RLS on, no policies), so
-- the token column is unreachable from any browser session.
-- ============================================================

CREATE TABLE IF NOT EXISTS youtube_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,

  -- Google OAuth refresh token, AES-GCM encrypted via
  -- src/lib/whatsapp/encryption.ts. Access tokens expire hourly and
  -- are minted from this on every upload — never stored.
  refresh_token TEXT NOT NULL,

  channel_id TEXT,
  channel_title TEXT,

  -- When true, the worker uploads every freshly rendered listing
  -- video to the channel automatically; manual per-property uploads
  -- work either way.
  auto_upload BOOLEAN NOT NULL DEFAULT TRUE,

  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'token_expired', 'disconnected')),

  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_youtube_config_account ON youtube_config(account_id);

ALTER TABLE youtube_config ENABLE ROW LEVEL SECURITY;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS youtube_video_id TEXT,
  ADD COLUMN IF NOT EXISTS youtube_status TEXT
    CHECK (youtube_status IN ('queued', 'uploading', 'ready', 'failed')),
  ADD COLUMN IF NOT EXISTS youtube_error TEXT,
  ADD COLUMN IF NOT EXISTS youtube_uploaded_at TIMESTAMPTZ;

COMMENT ON COLUMN properties.youtube_video_id IS
  'YouTube video id of the unlisted copy of the listing video; the Showcase embeds https://www.youtube-nocookie.com/embed/<id>.';
COMMENT ON COLUMN properties.youtube_status IS
  'Lifecycle of the YouTube upload: queued -> uploading -> ready | failed. NULL = never uploaded.';
