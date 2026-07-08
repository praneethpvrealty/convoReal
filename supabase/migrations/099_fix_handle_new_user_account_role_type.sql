-- ============================================================
-- 099_fix_handle_new_user_account_role_type.sql
--
-- BUG: this database's live handle_new_user() (last actually applied
-- version: 067_map_new_user_to_existing_account_by_phone.sql — 088
-- was never applied here) declares `v_account_role TEXT;` and later
-- does `INSERT INTO profiles (..., account_role, ...) VALUES (...,
-- v_account_role, ...)`. profiles.account_role is `account_role_enum`
-- (017_account_sharing.sql), and Postgres has no automatic
-- text -> user-defined-enum cast for a typed variable (only untyped
-- string literals coerce automatically), so every such INSERT throws:
--
--   column "account_role" is of type account_role_enum but
--   expression is of type text
--
-- Caught and swallowed by handle_new_user()'s own
-- `EXCEPTION WHEN OTHERS THEN RAISE WARNING ...; RETURN NEW;`, so
-- (independently of the now-fixed 098 org_role/account_role sync bug)
-- this alone already blocked every new signup: auth.users gets a row,
-- but accounts/profiles do not.
--
-- FIX: declare v_account_role as account_role_enum instead of TEXT.
-- Assigning the literal 'owner' to an enum-typed variable, and
-- COALESCE()-ing an already-enum-typed column (v_existing_profile.
-- account_role) with the literal 'agent', both resolve correctly —
-- it's only the TEXT-typed variable at the INSERT boundary that
-- needed an actual enum value. No other behavior changes; this keeps
-- the currently-live 067 logic (phone-based account matching) as-is
-- and does NOT introduce migration 088's credit-wallet/referral-code
-- signup hook, which was never applied to this database and is being
-- tracked as a separate decision.
--
-- Idempotent — CREATE OR REPLACE, safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
  v_account_role account_role_enum;
  v_existing_profile RECORD;
  v_clean_phone TEXT;
  v_matched BOOLEAN := FALSE;
  v_avatar_url TEXT := NULL;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  -- Clean the new user's phone number to get the last 10 digits for matching
  IF NEW.phone IS NOT NULL AND NEW.phone <> '' THEN
    v_clean_phone := regexp_replace(NEW.phone, '\D', '', 'g');
    IF length(v_clean_phone) >= 10 THEN
      v_clean_phone := right(v_clean_phone, 10);
    END IF;
  END IF;

  -- Try to find an existing profile where the phone number matches the last 10 digits
  IF v_clean_phone IS NOT NULL AND v_clean_phone <> '' THEN
    SELECT * INTO v_existing_profile
    FROM public.profiles
    WHERE regexp_replace(phone, '\D', '', 'g') LIKE '%' || v_clean_phone
    LIMIT 1;

    IF FOUND THEN
      v_matched := TRUE;
      -- Map to the existing account and role
      v_account_id := v_existing_profile.account_id;
      v_account_role := COALESCE(v_existing_profile.account_role, 'agent');
      v_avatar_url := v_existing_profile.avatar_url;

      -- If new user has no full name, inherit from existing profile
      IF v_full_name = '' THEN
        v_full_name := COALESCE(v_existing_profile.full_name, '');
      END IF;
    END IF;
  END IF;

  IF NOT v_matched THEN
    -- Create a new account
    INSERT INTO public.accounts (name, owner_user_id)
    VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
    RETURNING id INTO v_account_id;

    v_account_role := 'owner';
  END IF;

  -- Create the profile linked to the resolved account and save phone
  INSERT INTO public.profiles (user_id, full_name, email, phone, account_id, account_role, avatar_url)
  VALUES (
    NEW.id,
    v_full_name,
    COALESCE(NEW.email, ''),
    NEW.phone,
    v_account_id,
    v_account_role,
    v_avatar_url
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
