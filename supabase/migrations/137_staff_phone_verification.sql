-- ============================================================
-- 137_staff_phone_verification.sql — mandatory verified WhatsApp
-- number for staff users, hard-wired at the database.
--
-- ConvoReal is a WhatsApp-based platform: profiles.phone is the join
-- key for chatbot owner detection, agent reminders, credit alerts and
-- more — yet until now it was free-text, written unverified from the
-- settings form under the permissive profiles_update RLS policy.
--
-- From this migration on:
--   * Source of truth = auth.users.phone + phone_confirmed_at, which
--     only Supabase phone/phone_change OTP verification can set (the
--     OTP is delivered on WhatsApp via the existing Send-SMS hook).
--   * profiles.phone becomes a synced MIRROR of the verified phone,
--     updated by the trigger below — clients can no longer write it.
--   * The app gates the dashboard on phone_confirmed_at and verifies
--     once per account: a Google sign-in whose account already
--     verified a number is never asked again.
-- ============================================================

-- 1) Sync: whenever an auth user's phone becomes verified (first
--    verification or a phone_change), mirror it onto their profile.
--    Den users have no profiles row — the UPDATE is a harmless no-op.
CREATE OR REPLACE FUNCTION public.sync_verified_phone_to_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.phone IS NOT NULL AND NEW.phone <> '' AND NEW.phone_confirmed_at IS NOT NULL
     AND (OLD.phone IS DISTINCT FROM NEW.phone OR OLD.phone_confirmed_at IS NULL) THEN
    UPDATE public.profiles
    SET phone = '+' || regexp_replace(NEW.phone, '\D', '', 'g'),
        updated_at = NOW()
    WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sync_verified_phone_to_profile failed for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_phone_verified ON auth.users;
CREATE TRIGGER on_auth_user_phone_verified
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_verified_phone_to_profile();

-- 2) Guard: profiles.phone can no longer be changed by end-user
--    requests. auth.role() is the request JWT's role — 'authenticated'
--    for browser clients (blocked), 'service_role' for server routes
--    (allowed), and NULL for direct connections (GoTrue's own writes,
--    the sync trigger above, SQL-editor maintenance — allowed).
CREATE OR REPLACE FUNCTION public.profiles_guard_phone()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.phone IS DISTINCT FROM OLD.phone
     AND COALESCE(auth.role(), 'service_role') NOT IN ('service_role', 'supabase_admin') THEN
    RAISE EXCEPTION 'phone can only be changed through WhatsApp OTP verification';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_phone_guard ON public.profiles;
CREATE TRIGGER profiles_phone_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_phone();

-- 3) Backfill: users who already verified a phone (WhatsApp-OTP
--    logins) get their profile mirror aligned now.
UPDATE public.profiles p
SET phone = '+' || regexp_replace(u.phone, '\D', '', 'g'),
    updated_at = NOW()
FROM auth.users u
WHERE u.id = p.user_id
  AND u.phone IS NOT NULL
  AND u.phone <> ''
  AND u.phone_confirmed_at IS NOT NULL
  AND p.phone IS DISTINCT FROM ('+' || regexp_replace(u.phone, '\D', '', 'g'));
