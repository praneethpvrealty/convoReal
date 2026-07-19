-- ============================================================
-- Dedicated storage bucket for generated listing videos.
--
-- The property-images bucket restricts allowed_mime_types to images,
-- so the worker's MP4 upload failed with "mime type video/mp4 is not
-- supported". Videos get their own public bucket with a 20MB cap
-- (renders are ~2-3MB; WhatsApp's own limit is 16MB). Uploads happen
-- only through the worker's service-role client, so no extra storage
-- policies are needed; public=true serves playback URLs directly.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('property-videos', 'property-videos', true, 20971520, ARRAY['video/mp4'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 20971520,
      allowed_mime_types = ARRAY['video/mp4'];
