-- ============================================================
-- 173_showcase_share_links.sql
--
-- Per-share tokens for the generic showcase link. The mobile share
-- button broadcasts one identical URL, so every visit lands in Pulse
-- as an anonymous session with no origin. Minting a row here per share
-- and carrying its id on the link (?s=<id>) lets Pulse say "N visits
-- from the link you shared <when>" without knowing who received it.
-- Named attribution stays on v=<contact_id>; this only labels the
-- share instance.
-- ============================================================

CREATE TABLE IF NOT EXISTS showcase_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Who tapped share; kept when the profile goes so history survives.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_showcase_share_links_account
  ON showcase_share_links (account_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON showcase_share_links;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON showcase_share_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE showcase_share_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS showcase_share_links_select ON showcase_share_links;
CREATE POLICY showcase_share_links_select ON showcase_share_links FOR SELECT USING (
  is_account_member(account_id)
);

-- Minted through the authed API route with the caller's RLS client.
DROP POLICY IF EXISTS showcase_share_links_insert ON showcase_share_links;
CREATE POLICY showcase_share_links_insert ON showcase_share_links FOR INSERT WITH CHECK (
  is_account_member(account_id)
);

-- Events carry the share instance they came from; the beacon route
-- validates the id belongs to the account before stamping it.
ALTER TABLE showcase_events
  ADD COLUMN IF NOT EXISTS share_id UUID REFERENCES showcase_share_links(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_showcase_events_share
  ON showcase_events (account_id, share_id) WHERE share_id IS NOT NULL;
