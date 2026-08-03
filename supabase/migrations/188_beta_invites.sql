-- ============================================================
-- 188_beta_invites.sql — invite-only account creation.
--
-- ConvoReal already has two invite-shaped systems and neither one
-- does this:
--
--   account_invitations (017/019) invites a person INTO an existing
--     account as staff. redeem_invitation() deletes the invitee's
--     personal account and moves their profile across. It grows a
--     team inside one tenant; it never creates a tenant.
--   credit_wallets.referral_code (086/088) attributes an OPEN
--     signup and pays credits. It rewards signups, it doesn't gate
--     them, and it is unlimited.
--
-- A beta invite is the third thing: a token that AUTHORIZES THE
-- CREATION OF A NEW ACCOUNT. Separate table, separate URL space
-- (/i/<token>, since /join/<token> is taken by team invites), so
-- neither existing flow changes.
--
-- The gate itself lives in handle_new_user() — see migration 189.
-- This file is schema + the RPCs the app calls.
--
-- TENANCY NOTE (deliberate exception to the account_id rule)
-- ---------------------------------------------------------
-- beta_invites has NO `account_id NOT NULL`. It cannot: for a
-- founder seed there is no account at issuance time, and the whole
-- point of the row is to authorize creating one. It belongs with
-- `accounts` and `profiles` as a PLATFORM table, not an operational
-- one. `issued_by_account_id` is nullable by design (NULL = seed)
-- and is the column every tenant-facing policy filters on.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- TYPES
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'beta_invite_status') THEN
    CREATE TYPE beta_invite_status AS ENUM ('pending', 'accepted', 'revoked');
  END IF;
END $$;

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS beta_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Speakable code shown in the UI ("CONVO-7XKQ"). Not a secret and
  -- not used for lookup — that's token_hash. It exists so an invite
  -- can be read out over a phone call and found in the admin list.
  code TEXT NOT NULL UNIQUE,

  -- SHA-256 of the link token. The plaintext is returned exactly
  -- once at issuance and never stored, same discipline as
  -- account_invitations.token_hash (see src/lib/auth/invitations.ts).
  token_hash TEXT NOT NULL UNIQUE,

  -- NULL = founder seed (generation 0). Otherwise the account that
  -- spent one of its 5 seats to issue this.
  issued_by_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  issued_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  generation SMALLINT NOT NULL DEFAULT 0,

  label TEXT,
  invitee_phone TEXT,
  invitee_email TEXT,

  status beta_invite_status NOT NULL DEFAULT 'pending',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,

  accepted_at TIMESTAMPTZ,
  accepted_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,

  -- Seat number stamped at redemption (1..account_cap). Drives the
  -- "seat 34 of 100" hero on the invite page and is stable once set.
  seat_number INTEGER
);

CREATE INDEX IF NOT EXISTS idx_beta_invites_issuer
  ON beta_invites(issued_by_account_id)
  WHERE status <> 'revoked';

CREATE INDEX IF NOT EXISTS idx_beta_invites_pending
  ON beta_invites(expires_at)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS set_updated_at ON beta_invites;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON beta_invites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Which invite created this account, and how many seats it may pass
-- on. invite_quota is per-account so a seed broker can be given more
-- than the default without a schema change.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS beta_invite_id UUID REFERENCES beta_invites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invite_quota SMALLINT NOT NULL DEFAULT 5;

CREATE INDEX IF NOT EXISTS idx_accounts_beta_invite
  ON accounts(beta_invite_id)
  WHERE beta_invite_id IS NOT NULL;

-- ============================================================
-- beta_program — one row, the program's dials.
--
-- The cap, the quota and the kill switch are DATA. Raising the beta
-- from 100 to 250, or closing issuance at the end of the month, is
-- an UPDATE — not a deploy.
--
-- `id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id)` is the standard
-- single-row-table trick: only one value satisfies the check, so a
-- second row is impossible.
-- ============================================================
CREATE TABLE IF NOT EXISTS beta_program (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  account_cap INTEGER NOT NULL DEFAULT 100,
  default_quota SMALLINT NOT NULL DEFAULT 5,
  invite_ttl_days SMALLINT NOT NULL DEFAULT 14,
  -- FALSE closes new invite issuance without touching redemption of
  -- links already in the wild.
  issuance_open BOOLEAN NOT NULL DEFAULT TRUE,
  -- FALSE turns the whole gate off and restores open signup. The
  -- one-statement rollback if the gate misbehaves in production.
  gate_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  program_ends_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO beta_program (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS set_updated_at ON beta_program;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON beta_program
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- RLS
--
-- beta_invites: an admin sees the invites THEIR account issued.
-- Seeds (issued_by_account_id IS NULL) match no tenant and are
-- invisible to everyone but the service role. There is no INSERT
-- policy on purpose — issuance goes through issue_beta_invite()
-- so the quota check can't be bypassed by a direct insert.
--
-- beta_program: no tenant policy at all. Read through SECURITY
-- DEFINER functions, written by the service role.
-- ============================================================
ALTER TABLE beta_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE beta_program ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS beta_invites_select ON beta_invites;
CREATE POLICY beta_invites_select ON beta_invites
  FOR SELECT USING (
    issued_by_account_id IS NOT NULL
    AND is_account_member(issued_by_account_id, 'admin')
  );

-- ============================================================
-- hash_beta_token(text) — the one place hashing is defined.
--
-- sha256() is built into Postgres 11+, so this needs no extension.
-- pgcrypto's digest() would have been the obvious choice but it
-- lives in the `extensions` schema on Supabase and would not
-- resolve under the SET search_path = public that every SECURITY
-- DEFINER function here uses.
--
-- convert_to(..., 'UTF8') makes this byte-identical to Node's
-- createHash('sha256').update(token).digest('hex') in
-- src/lib/auth/invitations.ts, which is what produces the hashes
-- stored at issuance.
-- ============================================================
CREATE OR REPLACE FUNCTION public.hash_beta_token(p_token TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

ALTER FUNCTION public.hash_beta_token(TEXT) OWNER TO postgres;

-- ============================================================
-- beta_seats_taken() — the authoritative count.
--
-- Counts ACCOUNTS created by an invite, not accepted invites. Those
-- are the same number today, but the account row is what the cap is
-- actually about, and it survives an invite row being deleted.
-- ============================================================
CREATE OR REPLACE FUNCTION public.beta_seats_taken()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM accounts WHERE beta_invite_id IS NOT NULL;
$$;

ALTER FUNCTION public.beta_seats_taken() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.beta_seats_taken() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.beta_seats_taken() TO anon, authenticated, service_role;

-- ============================================================
-- beta_program_public() — the dials the app is allowed to see.
--
-- beta_program has RLS on with no policies, so nothing but the
-- service role can read the table directly. This exposes only the
-- fields the UI needs (cap, TTL, whether issuance is open) and
-- withholds gate_enabled, which is an operational switch and not
-- the client's business.
-- ============================================================
CREATE OR REPLACE FUNCTION public.beta_program_public()
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'account_cap', p.account_cap,
    'default_quota', p.default_quota,
    'invite_ttl_days', p.invite_ttl_days,
    'issuance_open', p.issuance_open,
    'program_ends_at', p.program_ends_at,
    'seats_taken', beta_seats_taken()
  )
  FROM beta_program p WHERE p.id;
$$;

ALTER FUNCTION public.beta_program_public() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.beta_program_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.beta_program_public() TO anon, authenticated, service_role;

-- ============================================================
-- peek_beta_invite(p_token_hash) — anonymous read for /i/<token>.
--
-- Returns one of:
--   { ok: true, inviter_name, inviter_account, expires_at,
--     seats_taken, account_cap, seat_number }
--   { ok: false, reason: 'not_found'|'revoked'|'expired'|'used'
--                        |'program_full', ... }
--
-- Like peek_invitation (019) this distinguishes the failure cases
-- rather than collapsing them to not_found: the page needs them for
-- UX ("ask <inviter> for a fresh link"), tokens carry 256 bits of
-- entropy, and the route is per-IP rate limited.
--
-- On the 'used' and 'expired' paths it still returns the inviter's
-- name, because the page's whole job in those states is to give the
-- visitor somewhere to go.
-- ============================================================
CREATE OR REPLACE FUNCTION public.peek_beta_invite(p_token_hash TEXT)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv beta_invites%ROWTYPE;
  v_prog beta_program%ROWTYPE;
  v_inviter_name TEXT;
  v_inviter_account TEXT;
  v_taken INTEGER;
BEGIN
  SELECT * INTO v_prog FROM beta_program WHERE id;
  v_taken := beta_seats_taken();

  SELECT * INTO v_inv FROM beta_invites WHERE token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'ok', false, 'reason', 'not_found',
      'seats_taken', v_taken, 'account_cap', v_prog.account_cap
    );
  END IF;

  -- Inviter identity. NULL issuer = founder seed; the page falls
  -- back to the product name rather than showing a blank.
  IF v_inv.issued_by_user_id IS NOT NULL THEN
    SELECT full_name INTO v_inviter_name
    FROM profiles WHERE user_id = v_inv.issued_by_user_id;
  END IF;
  IF v_inv.issued_by_account_id IS NOT NULL THEN
    SELECT name INTO v_inviter_account
    FROM accounts WHERE id = v_inv.issued_by_account_id;
  END IF;

  IF v_inv.status = 'revoked' THEN
    RETURN json_build_object(
      'ok', false, 'reason', 'revoked',
      'inviter_name', v_inviter_name, 'inviter_account', v_inviter_account,
      'seats_taken', v_taken, 'account_cap', v_prog.account_cap
    );
  END IF;

  IF v_inv.status = 'accepted' THEN
    RETURN json_build_object(
      'ok', false, 'reason', 'used',
      'inviter_name', v_inviter_name, 'inviter_account', v_inviter_account,
      'accepted_at', v_inv.accepted_at,
      'seats_taken', v_taken, 'account_cap', v_prog.account_cap
    );
  END IF;

  IF v_inv.expires_at <= NOW() THEN
    RETURN json_build_object(
      'ok', false, 'reason', 'expired',
      'inviter_name', v_inviter_name, 'inviter_account', v_inviter_account,
      'expires_at', v_inv.expires_at,
      'seats_taken', v_taken, 'account_cap', v_prog.account_cap
    );
  END IF;

  -- Computed live rather than read off a status column. A nightly
  -- job flipping pending invites to 'expired' when the cap lands
  -- would be stale between runs; this can't be.
  IF v_taken >= v_prog.account_cap THEN
    RETURN json_build_object(
      'ok', false, 'reason', 'program_full',
      'inviter_name', v_inviter_name, 'inviter_account', v_inviter_account,
      'seats_taken', v_taken, 'account_cap', v_prog.account_cap
    );
  END IF;

  RETURN json_build_object(
    'ok', true,
    'inviter_name', v_inviter_name,
    'inviter_account', v_inviter_account,
    'label', v_inv.label,
    'expires_at', v_inv.expires_at,
    'seats_taken', v_taken,
    'account_cap', v_prog.account_cap,
    -- The seat this invite WOULD take. Advisory until redemption
    -- stamps the real one, which is why the page says "seat 34 of
    -- 100" and not "your seat is 34".
    'seat_number', v_taken + 1
  );
END;
$$;

ALTER FUNCTION public.peek_beta_invite(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.peek_beta_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_beta_invite(TEXT) TO anon, authenticated, service_role;

-- ============================================================
-- issue_beta_invite(...) — spend one of the caller's seats.
--
-- SECURITY DEFINER because the quota check has to be atomic with
-- the insert; a direct INSERT under RLS could race two requests
-- past a 5-seat limit. There is deliberately no INSERT policy on
-- beta_invites, so this function is the only way in.
--
-- Quota is COUNTed under a lock on the caller's accounts row rather
-- than kept as a denormalized counter — a counter drifts the first
-- time an invite is revoked, and the count is over at most 5 rows
-- on an indexed column.
--
-- Refusal codes (SQLSTATE), mirroring 019's contract:
--   42501 — not authenticated / no profile
--   22023 — issuance closed, or quota exhausted
--
-- Seeds (generation 0) are minted by the service role calling this
-- with p_as_seed => TRUE, which skips the quota entirely.
-- ============================================================
CREATE OR REPLACE FUNCTION public.issue_beta_invite(
  p_token_hash TEXT,
  p_code TEXT,
  p_label TEXT DEFAULT NULL,
  p_invitee_phone TEXT DEFAULT NULL,
  p_invitee_email TEXT DEFAULT NULL,
  p_as_seed BOOLEAN DEFAULT FALSE
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_account_id UUID;
  v_quota SMALLINT;
  v_used INTEGER;
  v_prog beta_program%ROWTYPE;
  v_generation SMALLINT := 0;
  v_id UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_prog FROM beta_program WHERE id FOR UPDATE;

  IF NOT v_prog.issuance_open THEN
    RAISE EXCEPTION 'Beta invitations are closed' USING ERRCODE = '22023';
  END IF;

  v_expires := NOW() + (v_prog.invite_ttl_days || ' days')::INTERVAL;

  IF p_as_seed THEN
    -- Founder seed. No issuing account, no quota, generation 0.
    INSERT INTO beta_invites (
      code, token_hash, generation, label,
      invitee_phone, invitee_email, expires_at
    ) VALUES (
      p_code, p_token_hash, 0, p_label,
      p_invitee_phone, p_invitee_email, v_expires
    ) RETURNING id INTO v_id;

    RETURN json_build_object(
      'ok', true, 'id', v_id, 'code', p_code,
      'expires_at', v_expires, 'generation', 0
    );
  END IF;

  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT p.account_id INTO v_account_id
  FROM profiles p WHERE p.user_id = v_caller;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  -- Lock the account row so two concurrent issues can't both read a
  -- below-quota count and both insert.
  SELECT a.invite_quota INTO v_quota
  FROM accounts a WHERE a.id = v_account_id FOR UPDATE;

  SELECT COUNT(*)::INTEGER INTO v_used
  FROM beta_invites
  WHERE issued_by_account_id = v_account_id AND status <> 'revoked';

  IF v_used >= v_quota THEN
    RAISE EXCEPTION 'All % of your invitations have been used', v_quota
      USING ERRCODE = '22023';
  END IF;

  -- One past the inviter's own generation, so the tree depth is
  -- readable without walking parent links.
  SELECT COALESCE(bi.generation, 0) + 1 INTO v_generation
  FROM accounts a
  LEFT JOIN beta_invites bi ON bi.id = a.beta_invite_id
  WHERE a.id = v_account_id;

  INSERT INTO beta_invites (
    code, token_hash, issued_by_account_id, issued_by_user_id,
    generation, label, invitee_phone, invitee_email, expires_at
  ) VALUES (
    p_code, p_token_hash, v_account_id, v_caller,
    COALESCE(v_generation, 1), p_label, p_invitee_phone, p_invitee_email, v_expires
  ) RETURNING id INTO v_id;

  RETURN json_build_object(
    'ok', true, 'id', v_id, 'code', p_code,
    'expires_at', v_expires, 'generation', COALESCE(v_generation, 1),
    'used', v_used + 1, 'quota', v_quota
  );
END;
$$;

ALTER FUNCTION public.issue_beta_invite(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_beta_invite(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_beta_invite(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated, service_role;

-- ============================================================
-- revoke_beta_invite(p_id) — free a seat.
--
-- Only unredeemed invites can be revoked; an accepted one has an
-- account behind it and revoking would misreport the quota.
--
--   42501 — not authenticated / not an admin of the issuing account
--   22023 — already accepted, or not found
-- ============================================================
CREATE OR REPLACE FUNCTION public.revoke_beta_invite(p_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_inv beta_invites%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv FROM beta_invites WHERE id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;

  IF v_inv.issued_by_account_id IS NULL
     OR NOT is_account_member(v_inv.issued_by_account_id, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_inv.status = 'accepted' THEN
    RAISE EXCEPTION 'This invitation has already been claimed'
      USING ERRCODE = '22023';
  END IF;

  UPDATE beta_invites SET status = 'revoked' WHERE id = p_id;

  RETURN json_build_object('ok', true);
END;
$$;

ALTER FUNCTION public.revoke_beta_invite(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.revoke_beta_invite(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_beta_invite(UUID) TO authenticated, service_role;

COMMENT ON TABLE beta_invites IS
  'Invite-only account creation. A token here authorizes creating a NEW account (distinct from account_invitations, which adds staff to an existing one). Platform table: issued_by_account_id is nullable because a founder seed has no issuing account. Redemption happens inside handle_new_user() — see migration 189.';

COMMENT ON TABLE beta_program IS
  'Single-row dials for the invite-only beta: account cap, per-account invite quota, link TTL, and the two kill switches (issuance_open, gate_enabled). Changing the programme is an UPDATE, not a deploy.';
