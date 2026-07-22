-- ============================================================
-- 158_property_likes.sql
--
-- Property Likes: lightweight thumbs-up signal from public
-- showcase visitors. Unlike an inquiry (which captures a lead and
-- needs a phone number), a like is a one-tap, anonymous sentiment
-- vote that lets agents gauge how a property is landing.
--
-- Follows the Showcase Pulse (095) posture: rows are written only by
-- the service-role public route (no anon INSERT policy), keyed by the
-- visitor's random localStorage session_key. UNIQUE(session_key,
-- property_id) makes a like idempotent — one device can like a
-- property once. A denormalized properties.like_count is kept in sync
-- by trigger so both the showcase and the agent inventory can read the
-- tally without aggregating on every request.
-- ============================================================

CREATE TABLE IF NOT EXISTS property_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  -- Resolved from the ?v=/?ref= param when it points at a contact in
  -- this account; null for anonymous/portal traffic.
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  session_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_key, property_id)
);

CREATE INDEX IF NOT EXISTS idx_property_likes_property
  ON property_likes (property_id);
CREATE INDEX IF NOT EXISTS idx_property_likes_account_time
  ON property_likes (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_likes_contact
  ON property_likes (account_id, contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;

ALTER TABLE property_likes ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_property_likes_updated_at ON property_likes;
CREATE TRIGGER set_property_likes_updated_at BEFORE UPDATE ON property_likes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Account members read likes on their own properties; inserts/deletes
-- come only from the service-role public route (no anon policy).
DROP POLICY IF EXISTS property_likes_select ON property_likes;
CREATE POLICY property_likes_select ON property_likes FOR SELECT USING (
  is_account_member(account_id)
);

-- Denormalized tally on the property row.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION sync_property_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE properties SET like_count = like_count + 1 WHERE id = NEW.property_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE properties SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.property_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_property_like_count ON property_likes;
CREATE TRIGGER trg_sync_property_like_count
  AFTER INSERT OR DELETE ON property_likes
  FOR EACH ROW EXECUTE FUNCTION sync_property_like_count();
