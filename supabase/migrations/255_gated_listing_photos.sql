-- ============================================================
-- 255_gated_listing_photos.sql
--
-- Makes a confidential listing's photos actually confidential.
--
-- Gating (migration 254) withholds the photo LIST while the page is
-- gated, which stops a stranger seeing them. It did nothing about what
-- happens after approval: the page handed over `images`, whose entries
-- live in the public `property-images` bucket and resolve to direct CDN
-- URLs. Those URLs answer to anyone who has them, for as long as the
-- object exists — so a released photo could not be watermarked, could
-- not expire, and revoking the grant did not recall it. For a listing
-- whose whole premise is "the owner asked us to keep this quiet", that
-- was the wrong default.
--
-- Turning the switch on now moves the photos into the non-public
-- bucket, which is where the existing per-photo lock already puts them
-- and where the token proxy already watermarks them per recipient. The
-- listing then has no publicly-reachable photo at all, and an approved
-- viewer reads them through a key that expires and can be revoked.
--
-- This column records WHICH photos the gate moved, so turning the
-- switch back off restores exactly those and leaves photos the agent
-- locked by hand where they are. Without it, un-gating would either
-- publish someone's deliberately-private facade shot or strand the
-- listing with no photos at all.
-- ============================================================

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS gated_locked_images TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN properties.gated_locked_images IS
  'Photos moved to the private bucket BY the confidential switch (migration 255), so un-gating restores exactly these and not hand-locked ones. See src/lib/inventory/gated-photos.ts.';
