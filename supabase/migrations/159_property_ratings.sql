-- ============================================================
-- 159_property_ratings.sql
--
-- Buyer interest ratings: replaces the two separate showcase
-- prompts (Like + Are you interested?) with a single 1–10 fit
-- rating. One anonymous tap tells the agent HOW interested a
-- visitor is instead of a binary yes/no; sub-7 ratings can carry
-- optional "where's the miss?" reasons (budget / location /
-- property_type / size / other) that feed matching refinement.
--
-- Follows the property_likes (158) posture: rows are written only
-- by the service-role public route (no anon INSERT policy), keyed
-- by the visitor's random localStorage session_key.
-- UNIQUE(session_key, property_id) means re-rating updates the row.
-- Denormalized rating_count / rating_total on properties let the
-- showcase and agent inventory read the tally without aggregating.
-- ============================================================

CREATE TABLE IF NOT EXISTS property_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  -- Resolved from the ?v=/?ref= param when it points at a contact in
  -- this account; null for anonymous/portal traffic.
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  session_key TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 10),
  -- Optional low-rating feedback chips: budget, location,
  -- property_type, size, other.
  miss_reasons TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_key, property_id)
);

CREATE INDEX IF NOT EXISTS idx_property_ratings_property
  ON property_ratings (property_id);
CREATE INDEX IF NOT EXISTS idx_property_ratings_account_time
  ON property_ratings (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_ratings_contact
  ON property_ratings (account_id, contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;

ALTER TABLE property_ratings ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_property_ratings_updated_at ON property_ratings;
CREATE TRIGGER set_property_ratings_updated_at BEFORE UPDATE ON property_ratings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Account members read ratings on their own properties; inserts/updates
-- come only from the service-role public route (no anon policy).
DROP POLICY IF EXISTS property_ratings_select ON property_ratings;
CREATE POLICY property_ratings_select ON property_ratings FOR SELECT USING (
  is_account_member(account_id)
);

-- Denormalized tally on the property row.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_total INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION sync_property_rating_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE properties
      SET rating_count = rating_count + 1,
          rating_total = rating_total + NEW.rating
      WHERE id = NEW.property_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE properties
      SET rating_total = GREATEST(rating_total + NEW.rating - OLD.rating, 0)
      WHERE id = NEW.property_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE properties
      SET rating_count = GREATEST(rating_count - 1, 0),
          rating_total = GREATEST(rating_total - OLD.rating, 0)
      WHERE id = OLD.property_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_property_rating_stats ON property_ratings;
CREATE TRIGGER trg_sync_property_rating_stats
  AFTER INSERT OR UPDATE OF rating OR DELETE ON property_ratings
  FOR EACH ROW EXECUTE FUNCTION sync_property_rating_stats();
