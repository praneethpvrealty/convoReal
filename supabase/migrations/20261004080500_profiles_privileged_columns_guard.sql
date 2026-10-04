CREATE OR REPLACE FUNCTION profiles_guard_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Profiles are created by sign-up and the member RPCs, not by the client'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.account_role IS DISTINCT FROM OLD.account_role
     OR NEW.org_role IS DISTINCT FROM OLD.org_role
     OR NEW.is_read_only IS DISTINCT FROM OLD.is_read_only
     OR NEW.team_id IS DISTINCT FROM OLD.team_id
     OR NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Account, role, team and read-only status change only through the member RPCs'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_privileged_columns_guard ON profiles;
CREATE TRIGGER profiles_privileged_columns_guard
  BEFORE INSERT OR UPDATE OF account_id, account_role, org_role, is_read_only, team_id, role ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_guard_privileged_columns();
