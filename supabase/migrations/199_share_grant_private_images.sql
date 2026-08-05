-- ============================================================
-- 199_share_grant_private_images.sql
--
-- Extends share grants (migration 198) to cover the photos held back
-- by the location guard.
--
-- `properties.private_images` live in the non-public
-- `property-images-private` bucket, which has no read policy at all —
-- so revealing them is not a matter of widening a payload. The grant
-- token becomes the credential for a service-role proxy
-- (/api/public/share-grant/[token]/image/[index]), exactly as an
-- approved location request already does for /api/public/reveal.
--
-- Minting this is gated on canViewExactLocation() alongside
-- reveal_location: a facade photo identifies a house on the ground the
-- same way its address does, which is the whole reason these photos
-- are guarded (see src/lib/inventory/location-guard.ts).
-- ============================================================

ALTER TABLE property_share_grants
  ADD COLUMN IF NOT EXISTS reveal_private_images BOOLEAN NOT NULL DEFAULT FALSE;
