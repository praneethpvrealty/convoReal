-- ============================================================
-- 252_showcase_visibility.sql
--
-- Page-level gating for showcase URLs, above the field-level location
-- guard (migration 175).
--
-- The location guard withholds the address, pin and private photos but
-- still renders the listing. For a property whose owner has asked for
-- confidentiality that is not enough: the specs, the photo set and the
-- price are themselves the thing being protected, because together they
-- identify the property to anyone who works the same micro-market.
--
-- `showcase_visibility` decides how much of the page a stranger holding
-- the URL gets:
--   open   — today's behaviour; the location guard still applies.
--   teaser — a stub (type, locality, a price band, one cover photo) and
--            a "request access" gate. Everything else is withheld at
--            serialization, not hidden in CSS: the full payload rides
--            the RSC stream of a showcase render and is readable via
--            view-source, so a gated field must never leave the server.
--
-- NULL derives in code (src/lib/inventory/showcase-visibility.ts), the
-- same shape as location_privacy: no backfill, and a per-row override
-- stays possible. The CHECK is where a future fully-bound variant
-- ('gated', requiring OTP against a named recipient) lands.
--
-- Unlocking is the existing consent machinery, not a new one. A teaser
-- request is a property_location_request with scope='listing'; approving
-- it mints a property_share_grant carrying reveal_listing, so the
-- recipient's key expires, is revocable and counts its own opens
-- exactly like a grant minted from the share dialog.
-- ============================================================

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS showcase_visibility TEXT
    CHECK (showcase_visibility IN ('open', 'teaser'));

COMMENT ON COLUMN properties.showcase_visibility IS
  'Page-level showcase gating. NULL = derived (open). See src/lib/inventory/showcase-visibility.ts.';

-- What the requester is asking to be shown. 'location' is every request
-- minted before this migration, so the default preserves them exactly.
ALTER TABLE property_location_requests
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'location'
    CHECK (scope IN ('location', 'listing'));

-- Opens the whole teaser-gated page for the link this grant rides on.
-- Separate from reveal_location: a listing may be teaser-gated without
-- being location-guarded, and unlocking the page must not silently hand
-- over an address the guard is still holding back.
ALTER TABLE property_share_grants
  ADD COLUMN IF NOT EXISTS reveal_listing BOOLEAN NOT NULL DEFAULT FALSE;

-- The approval path writes the grant it minted back onto the request, so
-- the listing side can revoke a page unlock from the request it came
-- from instead of hunting for the grant.
ALTER TABLE property_location_requests
  ADD COLUMN IF NOT EXISTS granted_share_id UUID
    REFERENCES property_share_grants(id) ON DELETE SET NULL;

-- The teaser gate lists a visitor's own pending request by phone before
-- offering the form again.
CREATE INDEX IF NOT EXISTS idx_location_requests_scope_phone
  ON property_location_requests (property_id, scope, requester_phone)
  WHERE status = 'pending';
