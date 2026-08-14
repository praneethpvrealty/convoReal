-- ============================================================
-- 273_announcement_video.sql
-- The closed-window path for audio announcements (plan §7, path 2):
-- Meta has no audio template format, so the worker also packages the
-- voice note as an mp4 (branded still card + the narration) that a
-- VIDEO-header template can carry to contacts outside the 24-hour
-- window. The bucket gains the video mime type and headroom for it.
-- ============================================================

ALTER TABLE voice_announcements
  ADD COLUMN IF NOT EXISTS video_url TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'announcements',
  'announcements',
  TRUE,
  26214400, -- 25 MB
  ARRAY['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'video/mp4']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
