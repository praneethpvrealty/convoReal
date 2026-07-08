-- ============================================================
-- 098_fix_signup_role_sync_trigger.sql
--
-- BUG (breaks every new signup in production): sync_legacy_account_role()
-- (082_org_hierarchy.sql) used `IF TG_OP = 'INSERT' OR NEW.org_role IS
-- DISTINCT FROM OLD.org_role THEN` to decide whether org_role should
-- drive account_role. `TG_OP = 'INSERT'` is unconditionally true for
-- every insert, so the org_role-drives-account_role branch always ran
-- on INSERT — even when the caller never set org_role.
--
-- handle_new_user() (088_credits_referral_code_signup_hook.sql) inserts
-- into profiles with account_role set (e.g. 'owner') but never sets
-- org_role. NEW.org_role is therefore NULL, the CASE has no matching
-- WHEN/ELSE, and it evaluates to NULL — overwriting the caller's
-- account_role with NULL right before the row hits profiles'
-- `account_role NOT NULL` constraint (017_account_sharing.sql). Because
-- handle_new_user() wraps its body in `EXCEPTION WHEN OTHERS THEN
-- RAISE WARNING ...; RETURN NEW;`, the failure is swallowed: auth.users
-- gets a row, but profiles/accounts/credit_wallets do not.
--
-- FIX: only let org_role drive account_role on INSERT when org_role
-- was actually provided. A plain INSERT that sets account_role but not
-- org_role (handle_new_user's normal path) now falls into the
-- account_role-drives-org_role branch instead, mirroring how the
-- legacy RPCs (018_account_member_rpcs.sql: set_member_role,
-- remove_account_member, transfer_account_ownership) already behave on
-- UPDATE. UPDATE semantics are unchanged.
--
-- Idempotent — CREATE OR REPLACE, safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION sync_legacy_account_role() RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.org_role IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.org_role IS DISTINCT FROM OLD.org_role) THEN
    -- New-style write (org_role provided): org_role drives account_role.
    NEW.account_role := CASE NEW.org_role
      WHEN 'org_manager' THEN 'owner'::account_role_enum
      WHEN 'org_leader'  THEN 'admin'::account_role_enum
      WHEN 'org_agent'   THEN 'agent'::account_role_enum
    END;
  ELSIF (TG_OP = 'INSERT' AND NEW.account_role IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.account_role IS DISTINCT FROM OLD.account_role) THEN
    -- Legacy RPC / signup path: account_role drives org_role.
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
