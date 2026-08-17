-- ============================================================
-- 289_party_suggestion_dismissals.sql — "no, those two aren't together".
--
-- Party suggestions (src/lib/contacts/party-suggestions.ts) read signals
-- already in the book: two contacts on the same property's journey, the
-- same company, the same non-free email domain, a shared surname. Every
-- one of those has honest false positives — two unrelated buyers really
-- can be circling one listing.
--
-- Without a memory the panel would re-offer a rejected pair every time
-- the contact is opened, which is how a suggestion feature gets ignored.
-- Mirrors contact_duplicate_dismissals (migration 211), keyed on an
-- order-independent pair key so a dismissal sticks whichever of the two
-- the agent was looking at.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS party_suggestion_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- "<uuid>:<uuid>", the two contact ids sorted. Not two FK columns:
  -- the pair is the identity, and sorting makes the UNIQUE below do the
  -- deduplication rather than application code.
  pair_key TEXT NOT NULL,

  dismissed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, pair_key)
);

CREATE INDEX IF NOT EXISTS idx_party_suggestion_dismissals_account
  ON party_suggestion_dismissals (account_id);

DROP TRIGGER IF EXISTS set_updated_at ON party_suggestion_dismissals;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON party_suggestion_dismissals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE party_suggestion_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS party_suggestion_dismissals_select ON party_suggestion_dismissals;
CREATE POLICY party_suggestion_dismissals_select ON party_suggestion_dismissals FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS party_suggestion_dismissals_modify ON party_suggestion_dismissals;
CREATE POLICY party_suggestion_dismissals_modify ON party_suggestion_dismissals FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);
