-- ============================================================
-- One-time storage-URL backfill for the region migration.
--
-- Property images/documents/videos, avatars, and flow media are stored
-- in the database as ABSOLUTE Supabase public URLs that embed the
-- project ref (uploadPropertyImage() etc. persist getPublicUrl(...)).
-- When the DB was dumped old -> new project, those rows kept the OLD
-- ref, so the live app still fetches media from the old project's
-- storage. This rewrites every such URL to the new project's host.
--
-- Run this ONCE in the NEW project's SQL editor AFTER the storage
-- objects have been copied to the new project's buckets. It is
-- idempotent (re-running is a no-op) and only touches columns that
-- exist. Set the two hosts below before running.
-- ============================================================

DO $$
DECLARE
  old_host CONSTANT text := 'https://cvmgojajtegbuuujtptn.supabase.co';
  new_host CONSTANT text := 'https://ucqzafsbckmkeumgpxtb.supabase.co';
BEGIN
  -- properties.images (text[])
  IF to_regclass('public.properties') IS NOT NULL THEN
    UPDATE properties
    SET images = (SELECT array_agg(replace(x, old_host, new_host)) FROM unnest(images) AS x)
    WHERE array_to_string(images, ',') LIKE '%' || old_host || '%';

    UPDATE properties
    SET documents = (SELECT array_agg(replace(x, old_host, new_host)) FROM unnest(documents) AS x)
    WHERE array_to_string(documents, ',') LIKE '%' || old_host || '%';

    UPDATE properties
    SET video_url = replace(video_url, old_host, new_host)
    WHERE video_url LIKE '%' || old_host || '%';
  END IF;

  -- public_listing_submissions.images (text[])
  IF to_regclass('public.public_listing_submissions') IS NOT NULL THEN
    UPDATE public_listing_submissions
    SET images = (SELECT array_agg(replace(x, old_host, new_host)) FROM unnest(images) AS x)
    WHERE array_to_string(images, ',') LIKE '%' || old_host || '%';
  END IF;

  -- profiles.avatar_url, contacts.avatar_url (text) — only Supabase-hosted
  -- values match; external avatar URLs (e.g. WhatsApp CDN) are untouched.
  IF to_regclass('public.profiles') IS NOT NULL THEN
    UPDATE profiles SET avatar_url = replace(avatar_url, old_host, new_host)
    WHERE avatar_url LIKE '%' || old_host || '%';
  END IF;

  IF to_regclass('public.contacts') IS NOT NULL THEN
    UPDATE contacts SET avatar_url = replace(avatar_url, old_host, new_host)
    WHERE avatar_url LIKE '%' || old_host || '%';
  END IF;

  -- ctwa_referrals.image_url / video_url (text)
  IF to_regclass('public.ctwa_referrals') IS NOT NULL THEN
    UPDATE ctwa_referrals SET image_url = replace(image_url, old_host, new_host)
    WHERE image_url LIKE '%' || old_host || '%';
    UPDATE ctwa_referrals SET video_url = replace(video_url, old_host, new_host)
    WHERE video_url LIKE '%' || old_host || '%';
  END IF;

  -- flow_nodes.config (jsonb) — media_url lives inside the node config.
  IF to_regclass('public.flow_nodes') IS NOT NULL THEN
    UPDATE flow_nodes SET config = replace(config::text, old_host, new_host)::jsonb
    WHERE config::text LIKE '%' || old_host || '%';
  END IF;

  -- message_templates.header_media_url (text), if present.
  IF to_regclass('public.message_templates') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'message_templates'
         AND column_name = 'header_media_url'
     ) THEN
    UPDATE message_templates SET header_media_url = replace(header_media_url, old_host, new_host)
    WHERE header_media_url LIKE '%' || old_host || '%';
  END IF;
END $$;

-- Verification — every query below MUST return 0 before deleting the old
-- project. Replace the host if you changed it above.
-- SELECT count(*) FROM properties
--   WHERE array_to_string(images, ',') LIKE '%cvmgojajtegbuuujtptn%'
--      OR array_to_string(documents, ',') LIKE '%cvmgojajtegbuuujtptn%'
--      OR video_url LIKE '%cvmgojajtegbuuujtptn%';
-- SELECT count(*) FROM profiles WHERE avatar_url LIKE '%cvmgojajtegbuuujtptn%';
-- SELECT count(*) FROM contacts WHERE avatar_url LIKE '%cvmgojajtegbuuujtptn%';
-- SELECT count(*) FROM flow_nodes WHERE config::text LIKE '%cvmgojajtegbuuujtptn%';
