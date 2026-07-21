-- ============================================================
-- OPTIONAL cleanup backfill — companion to the storagePublicUrl()
-- refactor (src/lib/storage/url.ts).
--
-- New uploads store bucket-relative paths ("property-images/<acct>/x.jpg")
-- and reads resolve them via storagePublicUrl(). That resolver also
-- re-bases any absolute Supabase URL onto the current host, so legacy
-- absolute-URL rows already render correctly WITHOUT this script — it is
-- purely cosmetic normalisation of stored data to the relative form.
--
-- Only run this AFTER the storagePublicUrl() app changes are deployed.
-- It strips "https://<any-ref>.supabase.co/storage/v1/object/public/"
-- down to the bucket-relative path. Idempotent; touches only existing
-- columns. External (non-Supabase) URLs are left unchanged because they
-- don't match the marker.
-- ============================================================

DO $$
DECLARE
  marker CONSTANT text := '^https?://[^/]+/storage/v1/object/public/';
BEGIN
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

  IF to_regclass('public.public_listing_submissions') IS NOT NULL THEN
    UPDATE public_listing_submissions
    SET images = (SELECT array_agg(regexp_replace(x, marker, '')) FROM unnest(images) AS x)
    WHERE array_to_string(images, ',') ~ marker;
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    UPDATE profiles SET avatar_url = regexp_replace(avatar_url, marker, '')
    WHERE avatar_url ~ marker;
  END IF;

  IF to_regclass('public.contacts') IS NOT NULL THEN
    UPDATE contacts SET avatar_url = regexp_replace(avatar_url, marker, '')
    WHERE avatar_url ~ marker;
  END IF;

  IF to_regclass('public.ctwa_referrals') IS NOT NULL THEN
    UPDATE ctwa_referrals SET image_url = regexp_replace(image_url, marker, '')
    WHERE image_url ~ marker;
    UPDATE ctwa_referrals SET video_url = regexp_replace(video_url, marker, '')
    WHERE video_url ~ marker;
  END IF;

  IF to_regclass('public.flow_nodes') IS NOT NULL THEN
    UPDATE flow_nodes
    SET config = regexp_replace(config::text, marker, '', 'g')::jsonb
    WHERE config::text ~ marker;
  END IF;
END $$;
