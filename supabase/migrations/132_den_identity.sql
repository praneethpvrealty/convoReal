-- ============================================================
-- 132_den_identity.sql — Owners Den identity layer.
--
-- The Owners Den (src/app/(den)/) is the first authenticated surface
-- for property OWNERS — the people who own the real estate. Until now
-- they existed only as CRM `contacts` rows (classification 'Owner',
-- referenced by properties.owner_contact_id) with no login.
--
-- Den users are a PARALLEL identity class, not staff:
--   * an auth.users row with NO profiles row. Every existing RLS
--     policy gates through is_account_member() → profiles, so a Den
--     user is denied by every CRM policy by construction. That is the
--     isolation guarantee — owners can never see agents, other
--     tenants, or CRM internals. No existing policy changes here.
--   * All Den data access goes through /api/den/* route handlers
--     using the service-role client with explicit owner scoping
--     (src/lib/den/auth.ts). The RLS below is defense in depth.
--
-- Identity key is the VERIFIED WhatsApp phone on auth.users.phone
-- (WhatsApp OTP login via the existing Supabase Send-SMS hook, or
-- Google OAuth + mandatory phone_change verification). The phone
-- links the Den user to contacts across ALL tenant accounts — the
-- same owner may be managed by several agencies; one
-- den_contact_links row per (den_user, contact).
-- ============================================================

CREATE TABLE IF NOT EXISTS den_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  -- E.164-ish phone as stored on auth.users.phone at completion time,
  -- plus the last-10-digit form used for contact matching (the same
  -- convention as handle_new_user and the WhatsApp webhook).
  phone TEXT NOT NULL,
  phone_normalized TEXT NOT NULL,

  display_name TEXT,

  -- In-Den notification preferences (WhatsApp digest consent stays on
  -- contacts.owner_digest_consent — the Den settings screen writes
  -- both so the two channels agree).
  notify_matches BOOLEAN NOT NULL DEFAULT TRUE,
  notify_bids BOOLEAN NOT NULL DEFAULT TRUE,
  digest_frequency TEXT NOT NULL DEFAULT 'weekly'
    CHECK (digest_frequency IN ('off', 'daily', 'weekly')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_den_users_phone_normalized
  ON den_users(phone_normalized);

-- One row per (den user, CRM contact) — the bridge from a Den login
-- to the tenant-scoped contact rows (and through owner_contact_id,
-- to that tenant's properties). status 'revoked' lets an agency or
-- support sever a bad link without losing the audit trail.
CREATE TABLE IF NOT EXISTS den_contact_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  den_user_id UUID NOT NULL REFERENCES den_users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),

  -- The phone the den user held when this link was made — forensic
  -- trail if a number is ever recycled and relinked.
  phone_at_link TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (den_user_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_den_contact_links_user_status
  ON den_contact_links(den_user_id, status);
CREATE INDEX IF NOT EXISTS idx_den_contact_links_contact
  ON den_contact_links(contact_id);

-- Defense-in-depth RLS. The API layer (service role) is the real
-- boundary; these policies just let a den user read/update their own
-- identity row directly and nothing else. Inserts stay service-role
-- only (no INSERT policy).
ALTER TABLE den_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE den_contact_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS den_users_select_own ON den_users;
CREATE POLICY den_users_select_own ON den_users
  FOR SELECT USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS den_users_update_own ON den_users;
CREATE POLICY den_users_update_own ON den_users
  FOR UPDATE USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS den_contact_links_select_own ON den_contact_links;
CREATE POLICY den_contact_links_select_own ON den_contact_links
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM den_users du
      WHERE du.id = den_contact_links.den_user_id
        AND du.auth_user_id = auth.uid()
    )
  );

-- ============================================================
-- Contact lookup for Den linking. Matches the last-10-digit phone
-- convention used by handle_new_user()/the WhatsApp webhook, with the
-- digit-stripping done in SQL (contacts.phone formats vary — spaces,
-- dashes, +91 — so a supabase-js LIKE on the raw column is not
-- reliable). A contact qualifies as a property owner when it is
-- classified as one OR is referenced by any property's
-- owner_contact_id. Called by /api/den/auth/complete (service role);
-- revoked from everyone else.
-- ============================================================

CREATE OR REPLACE FUNCTION public.find_den_owner_contacts(p_phone_last10 TEXT)
RETURNS TABLE (contact_id UUID, account_id UUID, contact_name TEXT, classification TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.account_id, c.name, c.classification
  FROM contacts c
  WHERE p_phone_last10 <> ''
    AND right(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 10) = p_phone_last10
    AND (
      c.classification IN ('Owner', 'Seller', 'Owner & Buyer')
      OR EXISTS (SELECT 1 FROM properties p WHERE p.owner_contact_id = c.id)
    );
$$;

REVOKE ALL ON FUNCTION public.find_den_owner_contacts(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_den_owner_contacts(TEXT) FROM anon, authenticated;

-- ============================================================
-- Guard handle_new_user() against Den signups.
--
-- The live function (099_fix_handle_new_user_account_role_type.sql)
-- bootstraps a staff accounts + profiles pair for EVERY new auth
-- user. A Den owner must NOT become a CRM tenant — their identity
-- rows are created by POST /api/den/auth/complete instead.
--
-- This is a verbatim copy of the 099 body with ONE addition: the
-- early RETURN when the signup carries app_context = 'den' in its
-- user metadata (set by the Den login/signup flows). Keep any future
-- edits to this function in sync in both places.
--
-- Known limitation: supabase-js signInWithOAuth cannot attach user
-- metadata, so a GOOGLE-FIRST Den signup still bootstraps an (empty,
-- dormant) staff account+profile. That's harmless — Den isolation
-- never consults profiles, and the empty tenant leaks nothing — but
-- it is cruft; the WhatsApp-OTP path (the primary Den entry) is fully
-- guarded. Revisit if Supabase adds OAuth signup metadata.
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
  -- Owners Den signups get NO staff account/profile — their identity
  -- lives in den_users, created by /api/den/auth/complete.
  IF NEW.raw_user_meta_data->>'app_context' = 'den' THEN
    RETURN NEW;
  END IF;

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
