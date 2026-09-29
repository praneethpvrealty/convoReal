-- ============================================================
-- 20260929050125_journey_compartments.sql
-- Focus / Passive compartments for the Journey overview.
--
-- Inside each stage group an agent works the Focus journeys and
-- parks the rest as Passive. A journey with no row is Passive.
--
-- The split is shared by the whole team unless an admin switches
-- accounts.journey_compartment_scope to 'agent', when every agent
-- keeps their own: team rows carry user_id NULL, an agent's rows
-- carry their user id, and each scope reads only its own rows.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS journey_compartment_scope TEXT NOT NULL DEFAULT 'team'
  CHECK (journey_compartment_scope IN ('team', 'agent'));

CREATE TABLE IF NOT EXISTS journey_compartments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('buyer', 'property')),
  subject_id UUID NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  compartment TEXT NOT NULL CHECK (compartment IN ('focus', 'passive')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT journey_compartments_owner_key
    UNIQUE NULLS NOT DISTINCT (account_id, mode, subject_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_journey_compartments_account_mode
  ON journey_compartments(account_id, mode);

DROP TRIGGER IF EXISTS set_updated_at ON journey_compartments;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON journey_compartments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE journey_compartments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members view journey compartments" ON journey_compartments;
CREATE POLICY "Members view journey compartments" ON journey_compartments
  FOR SELECT USING (
    is_account_member(account_id)
    AND (user_id IS NULL OR user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Agents insert journey compartments" ON journey_compartments;
CREATE POLICY "Agents insert journey compartments" ON journey_compartments
  FOR INSERT WITH CHECK (
    is_account_member(account_id, 'agent')
    AND (user_id IS NULL OR user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Agents update journey compartments" ON journey_compartments;
CREATE POLICY "Agents update journey compartments" ON journey_compartments
  FOR UPDATE USING (
    is_account_member(account_id, 'agent')
    AND (user_id IS NULL OR user_id = auth.uid())
  )
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND (user_id IS NULL OR user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Agents delete journey compartments" ON journey_compartments;
CREATE POLICY "Agents delete journey compartments" ON journey_compartments
  FOR DELETE USING (
    is_account_member(account_id, 'agent')
    AND (user_id IS NULL OR user_id = auth.uid())
  );

COMMENT ON TABLE journey_compartments IS
  'Focus/Passive compartment for one journey (account_id + mode + subject_id); user_id NULL is the team split, otherwise that agent''s own. Absent row means Passive.';
COMMENT ON COLUMN accounts.journey_compartment_scope IS
  'Whose Focus/Passive split the Journey overview shows: team (shared) or agent (each agent their own). Admin-managed.';
