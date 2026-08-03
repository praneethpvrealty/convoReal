-- ============================================================
-- 189_gate_signup_on_beta_invite.sql — make account creation
-- invite-only.
--
-- BASELINE IS MIGRATION 160, NOT 099.
-- ----------------------------------
-- handle_new_user() has been redefined seven times (001, 017, 067,
-- 088, 099, 132, 160). The live body is 160's, and it opens with a
-- guard that 099 does not have:
--
--   IF NEW.raw_user_meta_data->>'app_context' IN ('den','buyer') THEN
--     RETURN NEW;
--   END IF;
--
-- Owners Den and buyer-portal users are auth.users rows with NO
-- profiles row — that absence IS their isolation, because every CRM
-- RLS policy gates through profiles. Rebuilding this function from
-- 099 would silently delete that guard, start minting staff accounts
-- for every property owner who logs in, and (post-gate) reject their
-- WhatsApp OTP logins outright. The guard is therefore reproduced
-- first, before anything else, and must survive every future edit.
--
-- Keep 099 / 132 / 160 / this file in sync, per 160's own note.
--
-- WHY THE TRIGGER AND NOT THE UI
-- ------------------------------
-- /signup refusing to render without an invite is a courtesy, not a
-- control: supabase.auth.signUp() is a public endpoint callable by
-- anyone holding the anon key. The only real gate is here, because a
-- RAISE aborts the auth.users INSERT and Supabase returns the message
-- to the client as a signup error.
--
-- WHY THE FUNCTION HAD TO BE RESTRUCTURED
-- ---------------------------------------
-- 160 ends with `EXCEPTION WHEN OTHERS THEN RAISE WARNING ...; RETURN
-- NEW;`. A gate added inside that block is a gate that does nothing —
-- the refusal is swallowed and the signup proceeds. So the gate is
-- hoisted ABOVE it and raises out uncaught, while the bootstrap keeps
-- its swallow-all behaviour unchanged. Making THAT strict is a
-- separate, riskier decision; the 098/099 comment history shows this
-- trigger has already silently broken signup twice.
--
-- The phone-match lookup moves up with it — the gate cannot know
-- whether a new tenant is coming without it — but keeps fail-open
-- semantics through its own inner handler, so a lookup error degrades
-- to "no match" and routes into the gate rather than bypassing it.
--
-- FOUR SIGNUP PATHS, ONLY ONE IS GATED
-- ------------------------------------
--   den / buyer  — early return above. No account, no profile, no gate.
--   phone match  — attaches to an existing account (067). NOT gated:
--                  no new tenant is created.
--   teammate     — /signup?invite=<team-token>. NOT gated: a valid
--                  account_invitations token is its own authorization.
--                  Gating it would take away every existing customer's
--                  ability to add staff. The throwaway account it
--                  creates is deleted seconds later by
--                  redeem_invitation() (019) and never counts as a seat.
--   new tenant   — everything else. GATED.
--
-- REDEMPTION HAPPENS HERE, NOT IN A LATER STEP
-- --------------------------------------------
-- The invite is marked accepted in the same transaction that creates
-- the account. The alternative — validate now, stamp after email
-- verification — leaves a window in which ONE token creates UNLIMITED
-- accounts, because nothing has been marked used yet. That defeats
-- the whole mechanism.
--
-- The cost is that an abandoned, never-verified signup burns a seat.
-- That is self-healing: beta_seats_taken() counts ACCOUNTS, so
-- deleting the dead account returns the seat to the pool.
--
-- ROLLBACK
-- --------
--   UPDATE beta_program SET gate_enabled = FALSE;
-- restores open signup immediately, no deploy. If the function itself
-- misbehaves, re-run migration 160 to restore the previous body.
--
-- Idempotent — CREATE OR REPLACE.
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

  v_prog beta_program%ROWTYPE;
  v_beta beta_invites%ROWTYPE;
  v_beta_token TEXT;
  v_team_token TEXT;
  v_team_ok BOOLEAN := FALSE;
  v_taken INTEGER;
  v_quota SMALLINT := 5;
BEGIN
  -- ============================================================
  -- Owners Den / buyer portal signups get NO staff account or
  -- profile — their identity lives in den_users / buyer_users,
  -- created by the respective /api/*/auth/complete routes.
  --
  -- FIRST, and before the gate: these users authenticate by WhatsApp
  -- OTP, carry no invite metadata, and would otherwise be refused —
  -- which would lock every property owner and buyer out of their
  -- portal. Verbatim from migration 160.
  -- ============================================================
  IF NEW.raw_user_meta_data->>'app_context' IN ('den', 'buyer') THEN
    RETURN NEW;
  END IF;

  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  -- ============================================================
  -- Phone match (migration 067 logic, behaviour unchanged).
  --
  -- Hoisted above the gate because the gate needs to know whether a
  -- new tenant is coming. Its own handler preserves the original
  -- fail-open semantics: a lookup error degrades to "no match",
  -- which routes into the gate rather than around it.
  -- ============================================================
  BEGIN
    IF NEW.phone IS NOT NULL AND NEW.phone <> '' THEN
      v_clean_phone := regexp_replace(NEW.phone, '\D', '', 'g');
      IF length(v_clean_phone) >= 10 THEN
        v_clean_phone := right(v_clean_phone, 10);
      END IF;
    END IF;

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
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: phone match failed for %: %', NEW.id, SQLERRM;
    v_matched := FALSE;
  END;

  -- ============================================================
  -- THE GATE — deliberately NOT inside an exception handler. Every
  -- RAISE below aborts the auth.users INSERT and surfaces to the
  -- client as a signup error.
  -- ============================================================
  IF NOT v_matched THEN
    -- FOR UPDATE serialises concurrent gated signups, which is what
    -- makes the cap check hold exactly at the boundary. Beta signup
    -- volume is tiny; correctness is worth the serialisation.
    SELECT * INTO v_prog FROM beta_program WHERE id FOR UPDATE;

    -- A missing beta_program row means a broken install, not an
    -- attack — only the service role can delete it. Fail OPEN so a
    -- config problem cannot brick signup entirely.
    IF FOUND AND v_prog.gate_enabled THEN
      v_team_token := NULLIF(NEW.raw_user_meta_data->>'team_invite', '');
      v_beta_token := NULLIF(NEW.raw_user_meta_data->>'beta_invite', '');

      -- A live team invite authorises this signup on its own.
      IF v_team_token IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM account_invitations
          WHERE token_hash = hash_beta_token(v_team_token)
            AND accepted_at IS NULL
            AND expires_at > NOW()
        ) INTO v_team_ok;
      END IF;

      IF NOT v_team_ok THEN
        IF v_beta_token IS NULL THEN
          RAISE EXCEPTION 'ConvoReal is invite-only right now. You need an invitation link to create an account.'
            USING ERRCODE = '22023';
        END IF;

        SELECT * INTO v_beta
        FROM beta_invites
        WHERE token_hash = hash_beta_token(v_beta_token)
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'That invitation link is not valid. Ask whoever invited you for a fresh one.'
            USING ERRCODE = '22023';
        END IF;
        IF v_beta.status = 'revoked' THEN
          RAISE EXCEPTION 'That invitation was withdrawn. Ask whoever invited you for a fresh one.'
            USING ERRCODE = '22023';
        END IF;
        IF v_beta.status = 'accepted' THEN
          RAISE EXCEPTION 'That invitation has already been claimed.'
            USING ERRCODE = '22023';
        END IF;
        IF v_beta.expires_at <= NOW() THEN
          RAISE EXCEPTION 'That invitation has expired. Ask whoever invited you for a fresh one.'
            USING ERRCODE = '22023';
        END IF;

        -- The cap is checked HERE, at redemption, because this is the
        -- only point at which the count is authoritative. Checking it
        -- at issuance would just move the failure to the door.
        v_taken := beta_seats_taken();
        IF v_taken >= v_prog.account_cap THEN
          RAISE EXCEPTION 'All % beta seats have been claimed.', v_prog.account_cap
            USING ERRCODE = '22023';
        END IF;

        v_quota := v_prog.default_quota;
      END IF;
    END IF;
  END IF;

  -- ============================================================
  -- Bootstrap. Keeps 160's swallow-all handler verbatim.
  --
  -- plpgsql's BEGIN/EXCEPTION opens a subtransaction, so if anything
  -- here fails the account insert AND the invite stamping roll back
  -- together — a seat is never burned by a half-done bootstrap.
  -- ============================================================
  BEGIN
    IF NOT v_matched THEN
      INSERT INTO public.accounts (name, owner_user_id, beta_invite_id, invite_quota)
      VALUES (
        COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'),
        NEW.id,
        v_beta.id,          -- NULL for team-invite and ungated signups
        COALESCE(v_quota, 5)
      )
      RETURNING id INTO v_account_id;

      v_account_role := 'owner';

      IF v_beta.id IS NOT NULL THEN
        UPDATE public.beta_invites
        SET status = 'accepted',
            accepted_at = NOW(),
            accepted_by_user_id = NEW.id,
            accepted_account_id = v_account_id,
            seat_number = v_taken + 1
        WHERE id = v_beta.id;
      END IF;
    END IF;

    INSERT INTO public.profiles (
      user_id, full_name, email, phone, account_id, account_role, avatar_url
    ) VALUES (
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
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Bootstraps account+profile on signup, and gates NEW TENANT creation on a valid beta invite (migration 188). Den/buyer signups return early with no profile; team invites and phone matches are deliberately ungated — see the header of migration 189. Kill switch: UPDATE beta_program SET gate_enabled = FALSE.';
