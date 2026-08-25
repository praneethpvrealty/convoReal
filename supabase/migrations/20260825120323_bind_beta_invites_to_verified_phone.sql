-- Bind an optional beta invite phone to the account owner's first
-- WhatsApp OTP verification. The invite is already linked to the new
-- account by handle_new_user(); this trigger is the authoritative guard.
-- Later verified phone changes remain allowed.

CREATE OR REPLACE FUNCTION public.sync_verified_phone_to_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_required_phone TEXT;
  v_required_digits TEXT;
  v_verified_digits TEXT;
BEGIN
  IF NEW.phone IS NOT NULL AND NEW.phone <> '' AND NEW.phone_confirmed_at IS NOT NULL
     AND (OLD.phone IS DISTINCT FROM NEW.phone OR OLD.phone_confirmed_at IS NULL) THEN
    IF OLD.phone_confirmed_at IS NULL THEN
      SELECT bi.invitee_phone
      INTO v_required_phone
      FROM public.accounts a
      JOIN public.beta_invites bi ON bi.id = a.beta_invite_id
      WHERE a.owner_user_id = NEW.id;

      IF NULLIF(BTRIM(v_required_phone), '') IS NOT NULL THEN
        v_required_digits := regexp_replace(v_required_phone, '\D', '', 'g');
        v_verified_digits := regexp_replace(NEW.phone, '\D', '', 'g');

        IF NOT (
          v_verified_digits = v_required_digits
          OR (
            length(v_required_digits) = 10
            AND right(v_verified_digits, 10) = v_required_digits
          )
        ) THEN
          RAISE EXCEPTION 'This invitation is reserved for a different WhatsApp number.'
            USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;

    UPDATE public.profiles
    SET phone = '+' || regexp_replace(NEW.phone, '\D', '', 'g'),
        updated_at = NOW()
    WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN SQLSTATE '22023' THEN
    RAISE;
  WHEN OTHERS THEN
    RAISE WARNING 'sync_verified_phone_to_profile failed for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_verified_phone_to_profile() IS
  'Mirrors OTP-verified Auth phones to profiles and enforces an optional beta invite phone on first verification.';
