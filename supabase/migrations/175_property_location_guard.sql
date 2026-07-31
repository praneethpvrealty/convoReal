-- ============================================================
-- 175_property_location_guard.sql
--
-- Location & photo guard for identifiable properties (independent
-- houses, villas, farm houses, land). Exact address / map pin /
-- coordinates and marked-private photos are withheld from public and
-- low-privilege viewers, and revealed only through an approved,
-- expiring, WhatsApp-delivered token (property_location_requests).
--
-- location_privacy is NULL by default: the effective value derives
-- from the property type in code (guarded types => 'locality'), so
-- houses and land are protected with zero backfill and a per-property
-- override remains possible. See src/lib/inventory/location-guard.ts.
-- ============================================================

-- 1. Per-property privacy override + private photo paths
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS location_privacy TEXT
    CHECK (location_privacy IN ('exact', 'locality')),
  ADD COLUMN IF NOT EXISTS private_images TEXT[] NOT NULL DEFAULT '{}';

-- 2. Location reveal requests (mirrors property_document_requests),
--    with co-broker consent-chain fields: a request that arrived
--    through a shared link is consented hop-by-hop up the sharing
--    chain (2h per hop) before the listing owner's final decision.
CREATE TABLE IF NOT EXISTS property_location_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  requester_name TEXT NOT NULL,
  requester_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  -- Share attribution: which minted link / co-broker contact the
  -- request came through. NULL = direct buyer request.
  via_share_id UUID REFERENCES showcase_share_links(id) ON DELETE SET NULL,
  via_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  -- Consent chain: [{contact_id, decision, at}] hops already walked;
  -- the contact currently being asked, and when they were asked (the
  -- 2h timeout anchor). NULL pending contact = awaiting the listing
  -- owner's final decision.
  consent_chain JSONB NOT NULL DEFAULT '[]',
  pending_consent_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  consent_requested_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  share_token TEXT UNIQUE,
  share_token_expires_at TIMESTAMPTZ,
  share_sent_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_location_requests_property
  ON property_location_requests (property_id, status);

CREATE INDEX IF NOT EXISTS idx_location_requests_account
  ON property_location_requests (account_id, status);

CREATE INDEX IF NOT EXISTS idx_location_requests_token
  ON property_location_requests (share_token) WHERE share_token IS NOT NULL;

-- The 2h consent-timeout sweep scans only requests awaiting a hop.
CREATE INDEX IF NOT EXISTS idx_location_requests_pending_consent
  ON property_location_requests (consent_requested_at)
  WHERE status = 'pending' AND pending_consent_contact_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON property_location_requests;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON property_location_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE property_location_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS location_requests_select ON property_location_requests;
CREATE POLICY location_requests_select ON property_location_requests FOR SELECT USING (
  is_account_member(account_id)
);

-- Approve/reject goes through the API route, which additionally
-- enforces admin-or-listing-agent; consent hops and public inserts go
-- through service-role routes only (no anon INSERT policy on purpose).
DROP POLICY IF EXISTS location_requests_update ON property_location_requests;
CREATE POLICY location_requests_update ON property_location_requests FOR UPDATE USING (
  is_account_member(account_id, 'agent')
);

-- 3. Non-public bucket for marked-private photos. No SELECT policy:
--    reads happen only through the authenticated proxy route or an
--    approved reveal token (both service-role).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'property-images-private',
  'property-images-private',
  FALSE,
  5242880, -- 5 MB, same as property-images
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Agents can upload private property images" ON storage.objects;
CREATE POLICY "Agents can upload private property images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'property-images-private'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );

DROP POLICY IF EXISTS "Agents can update private property images" ON storage.objects;
CREATE POLICY "Agents can update private property images"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'property-images-private'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );

DROP POLICY IF EXISTS "Agents can delete private property images" ON storage.objects;
CREATE POLICY "Agents can delete private property images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'property-images-private'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );
