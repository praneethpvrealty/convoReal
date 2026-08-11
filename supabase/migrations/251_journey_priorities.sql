-- ============================================================
-- 251_journey_priorities.sql
-- Per-journey priority for the Journey overview.
--
-- A "journey" has no row of its own — it is the set of journey_items
-- sharing a subject (a contact in buyer mode, a property in property
-- mode). Priority therefore keys on (account_id, mode, subject_id).
-- No row means "unrated"; clearing the priority deletes the row.
--
-- The overview ranks journeys by priority first so agents work the
-- top of the list, and renders the resulting position as #1, #2, …
-- ============================================================

CREATE TABLE IF NOT EXISTS journey_priorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('buyer', 'property')),
  subject_id UUID NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, mode, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_journey_priorities_account_mode
  ON journey_priorities(account_id, mode);

DROP TRIGGER IF EXISTS set_updated_at ON journey_priorities;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON journey_priorities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE journey_priorities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members view journey priorities" ON journey_priorities;
CREATE POLICY "Members view journey priorities" ON journey_priorities
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS "Agents insert journey priorities" ON journey_priorities;
CREATE POLICY "Agents insert journey priorities" ON journey_priorities
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Agents update journey priorities" ON journey_priorities;
CREATE POLICY "Agents update journey priorities" ON journey_priorities
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Agents delete journey priorities" ON journey_priorities;
CREATE POLICY "Agents delete journey priorities" ON journey_priorities
  FOR DELETE USING (is_account_member(account_id, 'agent'));

COMMENT ON TABLE journey_priorities IS
  'Manual priority for one journey (account_id + mode + subject_id); absent row means unrated.';
