-- ============================================================
-- 198_property_share_grants.sql
--
-- Pre-approved reveals for deliberate shares. The location guard
-- (migration 175) withholds the exact address, map pin and documents
-- from buyer-facing showcase links, and hands them over only through
-- an approved request. That is the right default for cold traffic, but
-- an agent sharing a listing with a buyer they already trust should be
-- able to unmask it at the moment of sharing instead of waiting for a
-- request to come back to their own queue.
--
-- A grant is minted per share from the property share dialog and rides
-- the showcase link as ?g=<token>. Binding it to a contact makes it a
-- per-recipient key: it expires, it can be revoked, and every open is
-- attributable. A grant with no contact is the generic-link variant —
-- same expiry and revocation, no named recipient.
--
-- Grants only ever WIDEN what one link shows. They are not a property
-- setting: revoking one, or letting it lapse, returns that link to the
-- masked default with nothing to undo on the listing.
-- ============================================================

CREATE TABLE IF NOT EXISTS property_share_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  -- NULL = generic link share (recipient unknown), mirroring the
  -- v=<contact_id> / s=<share_id> split on showcase_share_links.
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  -- Who granted it; kept when the profile goes so history survives.
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  token TEXT NOT NULL UNIQUE,
  reveal_location BOOLEAN NOT NULL DEFAULT FALSE,
  reveal_documents BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The public resolve path is token -> row, on every showcase render
-- that carries ?g=.
CREATE INDEX IF NOT EXISTS idx_property_share_grants_token
  ON property_share_grants (token);

-- The dialog lists live grants for the property it has open.
CREATE INDEX IF NOT EXISTS idx_property_share_grants_property
  ON property_share_grants (property_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_share_grants_account
  ON property_share_grants (account_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON property_share_grants;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON property_share_grants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE property_share_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS property_share_grants_select ON property_share_grants;
CREATE POLICY property_share_grants_select ON property_share_grants FOR SELECT USING (
  is_account_member(account_id)
);

-- Minting and revoking go through the authed API route with the
-- caller's RLS client. The route additionally enforces
-- canViewExactLocation() before granting reveal_location: an agent who
-- cannot see a guarded listing's pin must not be able to hand it out.
-- No anon policy on purpose — public reads are service-role, scoped by
-- token, in resolveShareGrant().
DROP POLICY IF EXISTS property_share_grants_insert ON property_share_grants;
CREATE POLICY property_share_grants_insert ON property_share_grants FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP POLICY IF EXISTS property_share_grants_update ON property_share_grants;
CREATE POLICY property_share_grants_update ON property_share_grants FOR UPDATE USING (
  is_account_member(account_id, 'agent')
);
