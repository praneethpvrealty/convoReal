-- ============================================================
-- 211_contact_duplicate_dismissals.sql
--
-- "We checked, they are different people."
--
-- The duplicates panel recomputes its groups on every check, so a pair
-- it was right to suggest and wrong to merge comes back every time.
-- Two live contacts named Arun Kumar — an owner reached on WhatsApp
-- and a Housing buyer — are a permanent suggestion nobody can answer,
-- and a panel that keeps asking a question you already answered is one
-- people stop reading.
--
-- Pairs, not groups. A group is derived, so its membership changes as
-- contacts arrive; keying on the whole set would either resurface the
-- pair whenever a third record joined, or hide the third record behind
-- a decision taken before it existed. Storing the pair means a group
-- stays dismissed exactly while every pair inside it has been
-- dismissed, and a genuinely new pairing surfaces on its own merits.
--
-- Ordering is canonical (a < b) so one decision cannot be stored twice
-- under two spellings.
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_duplicate_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Dies with either contact: once one is gone the pair cannot recur.
  contact_a_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  contact_b_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- Who decided; kept when the profile goes so the decision survives.
  dismissed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contact_duplicate_dismissals_ordered CHECK (contact_a_id < contact_b_id),
  CONSTRAINT contact_duplicate_dismissals_unique UNIQUE (account_id, contact_a_id, contact_b_id)
);

-- Every duplicate check reads the account's dismissals in one go.
CREATE INDEX IF NOT EXISTS idx_contact_duplicate_dismissals_account
  ON contact_duplicate_dismissals (account_id);

DROP TRIGGER IF EXISTS set_updated_at ON contact_duplicate_dismissals;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contact_duplicate_dismissals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE contact_duplicate_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_duplicate_dismissals_select ON contact_duplicate_dismissals;
CREATE POLICY contact_duplicate_dismissals_select ON contact_duplicate_dismissals FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS contact_duplicate_dismissals_insert ON contact_duplicate_dismissals;
CREATE POLICY contact_duplicate_dismissals_insert ON contact_duplicate_dismissals FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent')
);

-- Undo is a delete: the decision was wrong, not amended.
DROP POLICY IF EXISTS contact_duplicate_dismissals_delete ON contact_duplicate_dismissals;
CREATE POLICY contact_duplicate_dismissals_delete ON contact_duplicate_dismissals FOR DELETE USING (
  is_account_member(account_id, 'agent')
);
