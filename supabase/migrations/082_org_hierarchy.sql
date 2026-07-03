-- ============================================================
-- 082_org_hierarchy.sql
-- Replaces the flat owner/admin/agent/viewer role model with a
-- 3-tier org hierarchy (org_manager/org_leader/org_agent) plus
-- team-based WhatsApp conversation + contact routing.
--
-- Zero-touch RLS migration: is_account_member()'s SIGNATURE is
-- unchanged, so all ~124 existing call sites across 75+ policies
-- (migrations 013-076) keep working with zero edits. Only the
-- function BODY changes to read the new profiles.org_role column
-- instead of the legacy account_role.
--
-- Source design: ConvoReal-Engineering-OS/ORG_HIERARCHY_DESIGN.md
-- ============================================================

-- ============================================================
-- 1. New role enum + teams table
-- ============================================================
DO $$ BEGIN
  CREATE TYPE org_role_enum AS ENUM ('org_manager', 'org_leader', 'org_agent');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  leader_id UUID REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_teams_updated_at ON teams;
CREATE TRIGGER set_teams_updated_at BEFORE UPDATE ON teams 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_teams_account ON teams(account_id);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. profiles: org_role, team_id, is_read_only, coverage_areas, is_available
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS org_role org_role_enum,
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_read_only BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS coverage_areas TEXT[],
  ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_profiles_team_id ON profiles(team_id);

-- ============================================================
-- 3. Bidirectional role sync trigger.
--
--    Created BEFORE any data is backfilled (step 7 below) so it's
--    active for every write from this point on — including the
--    backfill itself — rather than being a special case the
--    backfill has to reason about separately.
--
--    New code writes org_role; the OLD account_role column is kept
--    in sync automatically so any as-yet-unmigrated reader doesn't
--    see stale data (dropped in a follow-up migration once confirmed
--    unused).
--
--    But three EXISTING RPCs predate this migration and only know
--    how to write account_role: set_member_role, remove_account_member,
--    and transfer_account_ownership (all in migration
--    018_account_member_rpcs.sql). Without the reverse direction,
--    those RPCs would silently leave org_role stale — and since
--    is_account_member() now reads org_role, permissions would
--    quietly stop matching what account_role (and the UI, which
--    still reads it in places) shows. So this trigger is
--    bidirectional: whichever column a caller actually changed
--    drives the other, checked via IS DISTINCT FROM so a same-value
--    write to one column doesn't spuriously re-derive the other.
-- ============================================================
CREATE OR REPLACE FUNCTION sync_legacy_account_role() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.org_role IS DISTINCT FROM OLD.org_role THEN
    -- New-style write (or first insert): org_role drives account_role.
    NEW.account_role := CASE NEW.org_role
      WHEN 'org_manager' THEN 'owner'::account_role_enum
      WHEN 'org_leader'  THEN 'admin'::account_role_enum
      WHEN 'org_agent'   THEN 'agent'::account_role_enum
    END;
  ELSIF NEW.account_role IS DISTINCT FROM OLD.account_role THEN
    -- Legacy RPC path: account_role drives org_role.
    NEW.org_role := CASE NEW.account_role
      WHEN 'owner'  THEN 'org_manager'::org_role_enum
      WHEN 'admin'  THEN 'org_leader'::org_role_enum
      WHEN 'agent'  THEN 'org_agent'::org_role_enum
      WHEN 'viewer' THEN 'org_agent'::org_role_enum
    END;
    IF NEW.account_role = 'viewer' THEN
      NEW.is_read_only := TRUE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_legacy_account_role_trigger ON profiles;
CREATE TRIGGER sync_legacy_account_role_trigger
  BEFORE INSERT OR UPDATE OF org_role, account_role ON profiles
  FOR EACH ROW EXECUTE FUNCTION sync_legacy_account_role();

-- ============================================================
-- 4. conversations: assignment/audit columns
--    (assigned_agent_id already exists from 001_initial_schema.sql)
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS assigned_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES profiles(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS routing_rule_used TEXT,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

-- ============================================================
-- 5. contacts: assignment columns
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS assigned_agent_id UUID REFERENCES profiles(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- ============================================================
-- 6. routing_rules table
-- ============================================================
CREATE TABLE IF NOT EXISTS routing_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN (
    'locality_match', 'source_match', 'keyword_match', 'round_robin', 'fallback'
  )),
  match_value TEXT,
  target_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  target_agent_id UUID REFERENCES profiles(user_id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routing_rules_account ON routing_rules(account_id) WHERE is_active;

ALTER TABLE routing_rules ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7. Performance indexes — keep the new RLS predicates index-supported
--    (denormalized team_id means these are plain equality lookups, not
--    per-row subquery joins; see Performance section of the plan).
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_contacts_account_assigned_agent ON contacts(account_id, assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_contacts_account_assigned_team ON contacts(account_id, assigned_team_id);
CREATE INDEX IF NOT EXISTS idx_conversations_account_assigned_agent ON conversations(account_id, assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_conversations_account_assigned_team ON conversations(account_id, assigned_team_id);

-- ============================================================
-- 8. Data migration: legacy account_role -> org_role.
--    viewer folds into org_agent + is_read_only=true (see plan).
--
--    Order matters: is_read_only must be set FIRST, while
--    account_role still holds its original 'viewer' value. The next
--    statement writes org_role, which fires the trigger above
--    (forward direction) and immediately re-derives account_role FROM
--    org_role — 'viewer' has no org_role equivalent, so it becomes
--    'agent'. If this ran first, the account_role = 'viewer' match
--    below would find zero rows.
-- ============================================================
UPDATE profiles SET is_read_only = TRUE WHERE account_role = 'viewer' AND NOT is_read_only;

UPDATE profiles SET org_role = CASE account_role
  WHEN 'owner'  THEN 'org_manager'::org_role_enum
  WHEN 'admin'  THEN 'org_leader'::org_role_enum
  WHEN 'agent'  THEN 'org_agent'::org_role_enum
  WHEN 'viewer' THEN 'org_agent'::org_role_enum
END
WHERE org_role IS NULL;

ALTER TABLE profiles ALTER COLUMN org_role SET NOT NULL;

-- ============================================================
-- 9. Auto-create a "Default Team" for every account with 2+ members
--    today. Solo accounts (exactly 1 member) are untouched — Solo Mode
--    requires no team at all. Existing contacts/conversations are left
--    UNASSIGNED (org_manager/org_leader still see them via the
--    unassigned-queue branch in the RLS policies below) — confirmed
--    with the user rather than guessing ownership from activity history.
-- ============================================================
DO $$
DECLARE
  acct RECORD;
  new_team_id UUID;
  first_leader_id UUID;
BEGIN
  FOR acct IN
    SELECT account_id, COUNT(*) AS member_count
    FROM profiles
    GROUP BY account_id
    HAVING COUNT(*) >= 2
  LOOP
    INSERT INTO teams (account_id, name)
    VALUES (acct.account_id, 'Default Team')
    RETURNING id INTO new_team_id;

    SELECT user_id INTO first_leader_id
    FROM profiles
    WHERE account_id = acct.account_id AND org_role = 'org_leader'
    ORDER BY created_at
    LIMIT 1;

    IF first_leader_id IS NOT NULL THEN
      UPDATE teams SET leader_id = first_leader_id WHERE id = new_team_id;
    END IF;

    UPDATE profiles
    SET team_id = new_team_id
    WHERE account_id = acct.account_id AND org_role IN ('org_leader', 'org_agent');
  END LOOP;
END $$;

-- ============================================================
-- 10. Rewrite is_account_member() — SIGNATURE UNCHANGED.
--     All ~124 existing call sites across 75+ policies keep
--     compiling and working with zero edits.
-- ============================================================
CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      -- Legacy literal -> rank (unchanged mapping, for the 75+ existing callers)
      AND CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        <=
          -- Actual stored org_role -> same 1-4 rank scale
          CASE p.org_role
            WHEN 'org_manager' THEN 4
            WHEN 'org_leader'  THEN 3
            WHEN 'org_agent'   THEN 2
          END
  );
$$;

-- ============================================================
-- 11. teams RLS — account members read; account admin+ (legacy
--     is_account_member still valid post-rewrite) or the team's own
--     leader can write.
-- ============================================================
DROP POLICY IF EXISTS teams_select ON teams;
CREATE POLICY teams_select ON teams FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS teams_insert ON teams;
CREATE POLICY teams_insert ON teams FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS teams_update ON teams;
CREATE POLICY teams_update ON teams FOR UPDATE USING (
  is_account_member(account_id, 'admin') OR leader_id = auth.uid()
);

DROP POLICY IF EXISTS teams_delete ON teams;
CREATE POLICY teams_delete ON teams FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- 12. routing_rules RLS — admin+ manage, account members read.
-- ============================================================
DROP POLICY IF EXISTS routing_rules_select ON routing_rules;
CREATE POLICY routing_rules_select ON routing_rules FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS routing_rules_modify ON routing_rules;
CREATE POLICY routing_rules_modify ON routing_rules FOR ALL USING (
  is_account_member(account_id, 'admin')
) WITH CHECK (
  is_account_member(account_id, 'admin')
);

-- ============================================================
-- 13. Team-scoped RLS on conversations, messages, contacts.
--     Additive to is_account_member('agent') — caller must still be
--     agent+ in the account, AND additionally match one of:
--       - org_manager (sees everything)
--       - assigned_team_id = caller's own team_id (Leader)
--       - assigned_agent_id = caller (Agent, or a Leader's own items)
--       - both assignment columns NULL, caller is manager/leader (queue)
--     Insert policies are left as the existing account-wide agent+
--     check — a newly created row naturally starts unassigned and is
--     visible via the queue branch to manager/leader.
-- ============================================================

DROP POLICY IF EXISTS conversations_select ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT USING (
  is_account_member(account_id) AND (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = conversations.account_id AND p.org_role = 'org_manager')
    OR assigned_agent_id = auth.uid()
    OR (assigned_team_id IS NOT NULL AND assigned_team_id = (SELECT p.team_id FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = conversations.account_id))
    OR (
      assigned_agent_id IS NULL AND assigned_team_id IS NULL
      AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = conversations.account_id AND p.org_role IN ('org_manager', 'org_leader'))
    )
  )
);

DROP POLICY IF EXISTS conversations_update ON conversations;
CREATE POLICY conversations_update ON conversations FOR UPDATE USING (
  is_account_member(account_id, 'agent') AND (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = conversations.account_id AND p.org_role = 'org_manager')
    OR assigned_agent_id = auth.uid()
    OR (assigned_team_id IS NOT NULL AND assigned_team_id = (SELECT p.team_id FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = conversations.account_id))
    OR (
      assigned_agent_id IS NULL AND assigned_team_id IS NULL
      AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = conversations.account_id AND p.org_role IN ('org_manager', 'org_leader'))
    )
  )
);

DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id)
      AND (
        EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = c.account_id AND p.org_role = 'org_manager')
        OR c.assigned_agent_id = auth.uid()
        OR (c.assigned_team_id IS NOT NULL AND c.assigned_team_id = (SELECT p.team_id FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = c.account_id))
        OR (
          c.assigned_agent_id IS NULL AND c.assigned_team_id IS NULL
          AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = c.account_id AND p.org_role IN ('org_manager', 'org_leader'))
        )
      )
  )
);

DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_modify ON messages FOR ALL USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND (
        EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = c.account_id AND p.org_role = 'org_manager')
        OR c.assigned_agent_id = auth.uid()
        OR (c.assigned_team_id IS NOT NULL AND c.assigned_team_id = (SELECT p.team_id FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = c.account_id))
        OR (
          c.assigned_agent_id IS NULL AND c.assigned_team_id IS NULL
          AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = c.account_id AND p.org_role IN ('org_manager', 'org_leader'))
        )
      )
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
  )
);

DROP POLICY IF EXISTS contacts_select ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT USING (
  is_account_member(account_id) AND (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = contacts.account_id AND p.org_role = 'org_manager')
    OR assigned_agent_id = auth.uid()
    OR (assigned_team_id IS NOT NULL AND assigned_team_id = (SELECT p.team_id FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = contacts.account_id))
    OR (
      assigned_agent_id IS NULL AND assigned_team_id IS NULL
      AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = contacts.account_id AND p.org_role IN ('org_manager', 'org_leader'))
    )
  )
);

DROP POLICY IF EXISTS contacts_update ON contacts;
CREATE POLICY contacts_update ON contacts FOR UPDATE USING (
  is_account_member(account_id, 'agent') AND (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = contacts.account_id AND p.org_role = 'org_manager')
    OR assigned_agent_id = auth.uid()
    OR (assigned_team_id IS NOT NULL AND assigned_team_id = (SELECT p.team_id FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = contacts.account_id))
    OR (
      assigned_agent_id IS NULL AND assigned_team_id IS NULL
      AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = contacts.account_id AND p.org_role IN ('org_manager', 'org_leader'))
    )
  )
);

-- Hard delete becomes Manager-only (was agent+) per the design doc's
-- explicit capability list ("Manager: Hard delete contacts or deals").
DROP POLICY IF EXISTS contacts_delete ON contacts;
CREATE POLICY contacts_delete ON contacts FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = contacts.account_id AND p.org_role = 'org_manager')
);
