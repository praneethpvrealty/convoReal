-- ============================================================
-- 088_credits_referral_code_signup_hook.sql
--
-- Extends handle_new_user() (last defined in migration 067) so a
-- brand-new account gets its credit_wallets row + referral_code at
-- creation time, instead of relying solely on the one-time backfill
-- in migration 085. Phone-matched signups (existing account reuse)
-- skip this — that account already has a wallet.
--
-- Also captures `?ref=CODE` from signup metadata onto accounts.
-- referred_by_code, so the referral relationship survives even if
-- the follow-up processReferralSignup() API call is never made (the
-- client passes referred_by_code via
-- supabase.auth.signUp({ options: { data: { referred_by_code } } })).
-- A reconciliation cron (referral engine, later migration/lib code)
-- can find any accounts.referred_by_code IS NOT NULL with no matching
-- referrals row and process them.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS referred_by_code TEXT;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
  v_account_role TEXT;
  v_existing_profile RECORD;
  v_clean_phone TEXT;
  v_matched BOOLEAN := FALSE;
  v_avatar_url TEXT := NULL;
  v_referred_by_code TEXT;
  v_wallet_code TEXT;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_referred_by_code := NULLIF(NEW.raw_user_meta_data->>'referred_by_code', '');

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
      v_account_id := v_existing_profile.account_id;
      v_account_role := COALESCE(v_existing_profile.account_role, 'agent');
      v_avatar_url := v_existing_profile.avatar_url;

      IF v_full_name = '' THEN
        v_full_name := COALESCE(v_existing_profile.full_name, '');
      END IF;
    END IF;
  END IF;

  IF NOT v_matched THEN
    -- Create a new account, capturing the referral code if present.
    INSERT INTO public.accounts (name, owner_user_id, referred_by_code)
    VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id, v_referred_by_code)
    RETURNING id INTO v_account_id;

    v_account_role := 'owner';

    -- Bootstrap the credit wallet for the brand-new account. Matched
    -- (phone-reuse) signups skip this — they join an account that
    -- already has a wallet from migration 085's backfill or this
    -- same branch on a prior signup.
    v_wallet_code := upper(left(regexp_replace(coalesce(v_full_name, 'ACCT'), '[^a-zA-Z]', '', 'g') || 'XXXX', 4))
                     || upper(substr(md5(random()::text || NEW.id::text), 1, 3));
    INSERT INTO public.credit_wallets (account_id, referral_code)
    VALUES (v_account_id, v_wallet_code)
    ON CONFLICT (account_id) DO NOTHING;
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
