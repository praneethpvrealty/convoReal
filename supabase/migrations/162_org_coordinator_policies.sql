-- ============================================================
-- 162_org_coordinator_policies.sql
--
-- Wires the 'coordinator' / 'org_coordinator' role (added in 161)
-- into the permission model:
--
--   1. sync_legacy_account_role() — map the new value both ways so
--      the account_role <-> org_role mirror stays consistent (the
--      legacy invite/members-dropdown/RPC path writes account_role;
--      is_account_member reads org_role).
--   2. is_account_member() — rank org_coordinator as agent-equivalent
--      (2): it clears agent+ gates (operational writes) but not admin+
--      gates (member management, settings, teams, routing_rules).
--   3. Team-scoped RLS on conversations/messages/contacts — give a
--      Coordinator the same account-wide visibility a Manager has
--      (see + edit everything, including the unassigned queue) WITHOUT
--      touching contacts hard-delete, which stays Manager-only.
--
-- No data backfill: nobody holds the new role yet.
--
-- Idempotent — CREATE OR REPLACE + DROP/CREATE POLICY.
-- ============================================================

-- ============================================================
-- 1. Bidirectional role sync — add the coordinator mapping.
--    Based on the current definition in 098_fix_signup_role_sync_trigger.sql.
--    A Coordinator is never read-only, so leaving the (viewer-only)
--    is_read_only flag set when a former viewer is promoted straight to
--    coordinator would wrongly lock them out — clear it explicitly.
-- ============================================================
CREATE OR REPLACE FUNCTION sync_legacy_account_role() RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.org_role IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.org_role IS DISTINCT FROM OLD.org_role) THEN
    -- New-style write (org_role provided): org_role drives account_role.
    NEW.account_role := CASE NEW.org_role
      WHEN 'org_manager'     THEN 'owner'::account_role_enum
      WHEN 'org_leader'      THEN 'admin'::account_role_enum
      WHEN 'org_coordinator' THEN 'coordinator'::account_role_enum
      WHEN 'org_agent'       THEN 'agent'::account_role_enum
    END;
    IF NEW.org_role = 'org_coordinator' THEN
      NEW.is_read_only := FALSE;
    END IF;
  ELSIF (TG_OP = 'INSERT' AND NEW.account_role IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.account_role IS DISTINCT FROM OLD.account_role) THEN
    -- Legacy RPC / signup / invite path: account_role drives org_role.
    NEW.org_role := CASE NEW.account_role
      WHEN 'owner'       THEN 'org_manager'::org_role_enum
      WHEN 'admin'       THEN 'org_leader'::org_role_enum
      WHEN 'coordinator' THEN 'org_coordinator'::org_role_enum
      WHEN 'agent'       THEN 'org_agent'::org_role_enum
      WHEN 'viewer'      THEN 'org_agent'::org_role_enum
    END;
    IF NEW.account_role = 'viewer' THEN
      NEW.is_read_only := TRUE;
    ELSIF NEW.account_role = 'coordinator' THEN
      NEW.is_read_only := FALSE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 2. is_account_member() — SIGNATURE UNCHANGED. Adds the coordinator
--    rows to both CASE arms. org_coordinator ranks 2 (agent-equivalent):
--    passes min_role 'agent'/'viewer', fails 'admin'/'owner'.
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
      AND CASE min_role
            WHEN 'owner'       THEN 4
            WHEN 'admin'       THEN 3
            WHEN 'coordinator' THEN 2
            WHEN 'agent'       THEN 2
            WHEN 'viewer'      THEN 1
          END
        <=
          CASE p.org_role
            WHEN 'org_manager'     THEN 4
            WHEN 'org_leader'      THEN 3
            WHEN 'org_coordinator' THEN 2
            WHEN 'org_agent'       THEN 2
          END
  );
$$;

-- ============================================================
-- 3. Team-scoped RLS — a Coordinator sees + edits everything in the
--    account, exactly like a Manager. Only the "sees everything"
--    branch changes: org_role = 'org_manager' becomes
--    org_role IN ('org_manager', 'org_coordinator'). The per-team /
--    assignment / unassigned-queue branches are unchanged (a
--    Coordinator is already covered by the account-wide branch).
--    contacts_delete (hard delete) is deliberately NOT touched — it
--    stays Manager-only.
-- ============================================================

DROP POLICY IF EXISTS conversations_select ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT USING (
  is_account_member(account_id) AND (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = conversations.account_id AND p.org_role IN ('org_manager', 'org_coordinator'))
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
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = conversations.account_id AND p.org_role IN ('org_manager', 'org_coordinator'))
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
        EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = c.account_id AND p.org_role IN ('org_manager', 'org_coordinator'))
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
        EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = c.account_id AND p.org_role IN ('org_manager', 'org_coordinator'))
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
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = contacts.account_id AND p.org_role IN ('org_manager', 'org_coordinator'))
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
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = contacts.account_id AND p.org_role IN ('org_manager', 'org_coordinator'))
    OR assigned_agent_id = auth.uid()
    OR (assigned_team_id IS NOT NULL AND assigned_team_id = (SELECT p.team_id FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = contacts.account_id))
    OR (
      assigned_agent_id IS NULL AND assigned_team_id IS NULL
      AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = contacts.account_id AND p.org_role IN ('org_manager', 'org_leader'))
    )
  )
);
