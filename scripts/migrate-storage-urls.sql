-- ============================================================
-- Make stored media references host-independent (one-time backfill).
--
-- Media (property images/documents/videos, avatars, flow media) was
-- historically stored as an ABSOLUTE Supabase public URL that embeds the
-- project ref, so every region migration orphaned the stored URLs. This
-- strips the host and keeps only the bucket-relative path
-- ("property-images/<acct>/img.jpg"). Once stored this way the data is
-- portable: the app rebuilds the URL from the CURRENT
-- NEXT_PUBLIC_SUPABASE_URL host at read time (src/lib/storage/url.ts), so
-- no future migration will ever need a URL rewrite again.
--
-- ⚠️  ORDER MATTERS. Run this ONLY AFTER the storagePublicUrl() app
--     changes are deployed. Bare relative paths render/​send correctly
--     only when every read goes through the resolver. If you run this
--     before the app is live, images break. (If you have NOT deployed the
--     resolver yet and just need the current migration to work, do a
--     host-to-host rewrite instead — replace the marker regex below with
--     the two literal hosts.)
--
-- Run ONCE in the NEW project's SQL editor, AFTER the storage objects
-- have been copied to the new project's buckets. Idempotent (re-running
-- is a no-op), touches only columns that exist, and matches ANY Supabase
-- host so it also normalises rows that already carry the new ref.
-- External (non-Supabase) URLs are left untouched because they don't
-- contain the storage marker.
-- ============================================================

DO $$
DECLARE
  -- Matches "https://<any-host>/storage/v1/object/public/" — the prefix
  -- of every stored public object URL, regardless of project ref.
  marker CONSTANT text := '^https?://[^/]+/storage/v1/object/public/';
BEGIN
  -- properties.images / documents (text[]), video_url (text)
  IF to_regclass('public.properties') IS NOT NULL THEN
    UPDATE properties
    SET images = (SELECT array_agg(regexp_replace(x, marker, '')) FROM unnest(images) AS x)
    WHERE array_to_string(images, ',') ~ marker;

    UPDATE properties
    SET documents = (SELECT array_agg(regexp_replace(x, marker, '')) FROM unnest(documents) AS x)
    WHERE array_to_string(documents, ',') ~ marker;

    UPDATE properties
    SET video_url = regexp_replace(video_url, marker, '')
    WHERE video_url ~ marker;
  END IF;

  -- public_listing_submissions.images (text[])
  IF to_regclass('public.public_listing_submissions') IS NOT NULL THEN
    UPDATE public_listing_submissions
    SET images = (SELECT array_agg(regexp_replace(x, marker, '')) FROM unnest(images) AS x)
    WHERE array_to_string(images, ',') ~ marker;
  END IF;

  -- profiles.avatar_url, contacts.avatar_url (text) — only Supabase-hosted
  -- values match; external avatar URLs (e.g. WhatsApp CDN) are untouched.
  IF to_regclass('public.profiles') IS NOT NULL THEN
    UPDATE profiles SET avatar_url = regexp_replace(avatar_url, marker, '')
    WHERE avatar_url ~ marker;
  END IF;

  IF to_regclass('public.contacts') IS NOT NULL THEN
    UPDATE contacts SET avatar_url = regexp_replace(avatar_url, marker, '')
    WHERE avatar_url ~ marker;
  END IF;

  -- ctwa_referrals.image_url / video_url (text)
  IF to_regclass('public.ctwa_referrals') IS NOT NULL THEN
    UPDATE ctwa_referrals SET image_url = regexp_replace(image_url, marker, '')
    WHERE image_url ~ marker;
    UPDATE ctwa_referrals SET video_url = regexp_replace(video_url, marker, '')
    WHERE video_url ~ marker;
  END IF;

  -- flow_nodes.config (jsonb) — media_url lives inside the node config.
  IF to_regclass('public.flow_nodes') IS NOT NULL THEN
    UPDATE flow_nodes
    SET config = regexp_replace(config::text, marker, '', 'g')::jsonb
    WHERE config::text ~ marker;
  END IF;

  -- message_templates.header_media_url (text), if present.
  IF to_regclass('public.message_templates') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'message_templates'
         AND column_name = 'header_media_url'
     ) THEN
    UPDATE message_templates SET header_media_url = regexp_replace(header_media_url, marker, '')
    WHERE header_media_url ~ marker;
  END IF;
END $$;

-- Verification — every query below MUST return 0 afterwards (no stored
-- value still carries a Supabase storage host).
-- SELECT count(*) FROM properties
--   WHERE array_to_string(images, ',') ~ '/storage/v1/object/public/'
--      OR array_to_string(documents, ',') ~ '/storage/v1/object/public/'
--      OR video_url ~ '/storage/v1/object/public/';
-- SELECT count(*) FROM profiles WHERE avatar_url ~ '/storage/v1/object/public/';
-- SELECT count(*) FROM flow_nodes WHERE config::text ~ '/storage/v1/object/public/';
