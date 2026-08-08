-- ============================================================
-- 216_chat_media_bucket.sql
-- Storage for media an agent sends into a WhatsApp thread.
--
-- Meta fetches outbound media by PUBLIC URL (sendMediaMessage takes a
-- `link`), so this bucket has to be public — a signed URL would expire
-- before Meta's fetcher used it, and a private one it cannot read at
-- all. Nothing sensitive belongs here: it is the same content the
-- recipient is about to receive on their phone.
--
-- Separate from property-images/-videos/-documents on purpose. Those
-- are inventory, subject to the image-cleanup sweep that deletes
-- objects no property row references any more; a chat attachment has
-- no property to be referenced by and would be collected.
--
-- Size cap is WhatsApp's own ceiling for the largest kind it accepts
-- (documents, 100 MB). Per-kind limits are enforced at the upload
-- route, which knows which kind it is handling.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  TRUE,
  104857600, -- 100 MB
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/3gpp',
    'audio/aac',
    'audio/mp4',
    'audio/mpeg',
    'audio/amr',
    'audio/ogg',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = TRUE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Writes go through the service-role upload route, which scopes the
-- object path to the caller's account. These policies exist so the
-- bucket is readable by anyone (Meta included) and never writable from
-- a browser session.
DROP POLICY IF EXISTS "Chat media is publicly readable" ON storage.objects;
CREATE POLICY "Chat media is publicly readable" ON storage.objects
  FOR SELECT USING (bucket_id = 'chat-media');
