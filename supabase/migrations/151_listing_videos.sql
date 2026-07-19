-- ============================================================
-- Auto-generated listing videos (photos → narrated teaser MP4).
--
-- The video itself is rendered by the queue worker
-- (src/lib/video/listing-video-worker.ts) and stored in the
-- property-images bucket under videos/; these columns track the
-- lifecycle so the property form can show status and the Showcase
-- can embed the result. Generation is charged through the credits
-- engine (AI_FEATURE_COSTS.listing_video) and narrated via Sarvam
-- TTS in the language stored here.
-- ============================================================

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS video_url TEXT,
  ADD COLUMN IF NOT EXISTS video_status TEXT
    CHECK (video_status IN ('queued', 'processing', 'ready', 'failed')),
  ADD COLUMN IF NOT EXISTS video_language TEXT,
  ADD COLUMN IF NOT EXISTS video_error TEXT,
  ADD COLUMN IF NOT EXISTS video_generated_at TIMESTAMPTZ;

COMMENT ON COLUMN properties.video_url IS
  'Public URL of the auto-generated (or uploaded) listing teaser video, WhatsApp-sized (<=16MB).';
COMMENT ON COLUMN properties.video_status IS
  'Lifecycle of the queued video render: queued -> processing -> ready | failed. NULL = never generated.';
COMMENT ON COLUMN properties.video_language IS
  'BCP-47 narration language for the generated video (en-IN, hi-IN, kn-IN, ...).';
