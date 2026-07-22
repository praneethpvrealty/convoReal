-- ============================================================
-- 160_buyer_identity.sql — Buyer portal identity layer.
--
-- The buyer portal (src/app/(buyer)/) is the authenticated surface
-- for property BUYERS — the leads captured by the public showcase
-- (classification 'Buyer', created by /api/public/inquiry and
-- /api/public/requirements). Until now they existed only as CRM
-- `contacts` rows with no login.
--
-- Buyer users follow the Owners Den pattern (migration 132) exactly:
--   * an auth.users row with NO profiles row. Every existing RLS
--     policy gates through is_account_member() → profiles, so a
--     buyer user is denied by every CRM policy by construction.
--   * All buyer data access goes through /api/buyer/* route handlers
--     using the service-role client with explicit scoping
--     (src/lib/buyer/auth.ts). The RLS below is defense in depth.
--
-- Identity key is the VERIFIED WhatsApp phone on auth.users.phone.
-- The phone links the buyer to contacts across ALL tenant accounts —
-- the same buyer may be a lead with several agencies; one
-- buyer_contact_links row per (buyer_user, contact).
-- ============================================================

CREATE TABLE IF NOT EXISTS buyer_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  phone TEXT NOT NULL,
  phone_normalized TEXT NOT NULL,

  display_name TEXT,

  -- In-portal notification preference (WhatsApp alert consent stays on
  -- contacts.buyer_alerts_consent — the settings screen writes both so
  -- the two channels agree).
  notify_matches BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_buyer_users_phone_normalized
  ON buyer_users(phone_normalized);

CREATE TABLE IF NOT EXISTS buyer_contact_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id UUID NOT NULL REFERENCES buyer_users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),

  phone_at_link TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (buyer_user_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_buyer_contact_links_user_status
  ON buyer_contact_links(buyer_user_id, status);
CREATE INDEX IF NOT EXISTS idx_buyer_contact_links_contact
  ON buyer_contact_links(contact_id);

-- The buyer's saved shortlist. Seeded from contact-attributed showcase
-- ratings/likes on first login (src/lib/buyer/linking.ts) and managed
-- from the portal afterwards. account_id mirrors the property's owning
-- tenant so tenant-scoped queries stay possible.
CREATE TABLE IF NOT EXISTS buyer_shortlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id UUID NOT NULL REFERENCES buyer_users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,

  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'rating', 'like')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (buyer_user_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_buyer_shortlist_items_user
  ON buyer_shortlist_items(buyer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_buyer_shortlist_items_account
  ON buyer_shortlist_items(account_id);

DROP TRIGGER IF EXISTS set_updated_at ON buyer_users;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON buyer_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at ON buyer_shortlist_items;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON buyer_shortlist_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Defense-in-depth RLS. The API layer (service role) is the real
-- boundary; these policies just let a buyer read/update their own
-- identity row directly and nothing else. Inserts stay service-role
-- only (no INSERT policy).
ALTER TABLE buyer_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_contact_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_shortlist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS buyer_users_select_own ON buyer_users;
CREATE POLICY buyer_users_select_own ON buyer_users
  FOR SELECT USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS buyer_users_update_own ON buyer_users;
CREATE POLICY buyer_users_update_own ON buyer_users
  FOR UPDATE USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS buyer_contact_links_select_own ON buyer_contact_links;
CREATE POLICY buyer_contact_links_select_own ON buyer_contact_links
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM buyer_users bu
      WHERE bu.id = buyer_contact_links.buyer_user_id
        AND bu.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS buyer_shortlist_items_select_own ON buyer_shortlist_items;
CREATE POLICY buyer_shortlist_items_select_own ON buyer_shortlist_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM buyer_users bu
      WHERE bu.id = buyer_shortlist_items.buyer_user_id
        AND bu.auth_user_id = auth.uid()
    )
  );

-- ============================================================
-- WhatsApp alert consent for buyers — the buyer-side twin of
-- contacts.owner_digest_consent (migration 126). Toggled by the
-- buyer's own "STOP ALERTS"/"START ALERTS" WhatsApp replies and by
-- the buyer portal settings screen; both channels edit this column
-- so they always agree.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS buyer_alerts_consent TEXT NOT NULL DEFAULT 'pending'
    CHECK (buyer_alerts_consent IN ('pending', 'granted', 'declined'));

COMMENT ON COLUMN contacts.buyer_alerts_consent IS
  'Buyer''s WhatsApp property-alert consent: pending (never asked), granted, declined. Managed by STOP ALERTS/START ALERTS chat commands and the buyer portal.';

-- ============================================================
-- Contact lookup for buyer linking. Same last-10-digit convention as
-- find_den_owner_contacts (migration 132). A contact qualifies as a
-- buyer when classified as one OR when it carries buyer signals
-- (a property inquiry or a showcase rating). Called by
-- /api/buyer/auth/complete (service role); revoked from everyone else.
-- ============================================================

CREATE OR REPLACE FUNCTION public.find_buyer_contacts(p_phone_last10 TEXT)
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
      c.classification IN ('Buyer', 'Owner & Buyer')
      OR EXISTS (SELECT 1 FROM contact_property_inquiries i WHERE i.contact_id = c.id)
      OR EXISTS (SELECT 1 FROM property_ratings r WHERE r.contact_id = c.id)
    );
$$;

REVOKE ALL ON FUNCTION public.find_buyer_contacts(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_buyer_contacts(TEXT) FROM anon, authenticated;

-- ============================================================
-- Guard handle_new_user() against buyer portal signups.
--
-- Verbatim copy of the migration 132 body with ONE change: the early
-- RETURN now covers app_context 'buyer' as well as 'den' (set by the
-- buyer/Den login flows). Keep any future edits to this function in
-- sync in all copies (099, 132, here).
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
  -- Owners Den / buyer portal signups get NO staff account/profile —
  -- their identity lives in den_users / buyer_users, created by the
  -- respective /api/*/auth/complete routes.
  IF NEW.raw_user_meta_data->>'app_context' IN ('den', 'buyer') THEN
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
