-- ============================================================
-- 256_account_api_keys.sql — per-account API keys for non-browser
-- clients (the MCP server, automation platforms, partner scripts).
--
-- Until now the only non-cookie transport was the mobile app's
-- Supabase bearer JWT, which is short-lived and refresh-token bound —
-- fine for an app holding a session, useless for a long-running agent
-- or an integration that has to authenticate unattended.
--
-- Only the SHA-256 hash of a key is stored. The plaintext secret is
-- returned exactly once, at creation, and is unrecoverable afterwards;
-- a lost key is rotated, not looked up. The hash is a plain digest
-- rather than bcrypt/argon2 on purpose: the secret is 256 bits of CSPRNG
-- output, so there is no dictionary to attack and the per-request cost
-- of a slow KDF would buy nothing.
--
-- Keys authenticate to /api/v1/* only (see src/lib/auth/api-keys.ts).
-- That surface uses the service-role client under EXPLICIT account
-- scoping, the same shape as the Den and buyer portals — a key is not
-- a Supabase session, so RLS is not what scopes it.
--
-- Ordinary operational table: account_id NOT NULL, RLS on, updated_at
-- trigger. Management is admin-only; the verification path reads
-- through the service-role client and so does not depend on a policy.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS account_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Human label shown in settings ("Claude Desktop", "n8n prod").
  name TEXT NOT NULL,

  -- Leading segment of the plaintext key, stored so the UI can tell
  -- two keys apart without holding either secret.
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,

  -- Coarse capability grants. 'read' covers every GET; 'write' is
  -- required by the handful of mutating v1 routes. No key may touch
  -- WhatsApp sending, billing, or member management at any scope.
  scopes TEXT[] NOT NULL DEFAULT ARRAY['read']::TEXT[]
    CHECK (scopes <@ ARRAY['read', 'write']::TEXT[] AND array_length(scopes, 1) >= 1),

  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_api_keys_account
  ON account_api_keys (account_id, created_at DESC);

-- The verification path's only query: hash lookup among live keys.
CREATE INDEX IF NOT EXISTS idx_account_api_keys_live
  ON account_api_keys (key_hash) WHERE revoked_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at ON account_api_keys;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON account_api_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE account_api_keys ENABLE ROW LEVEL SECURITY;

-- Admin-and-above only, for every verb. An agent or viewer has no
-- reason to enumerate an account's integration credentials, and
-- issuing one is a privileged act. Creation and revocation still go
-- through /api/account/api-keys, which re-checks the role server-side;
-- these policies are the backstop for direct PostgREST access.
DROP POLICY IF EXISTS account_api_keys_select ON account_api_keys;
CREATE POLICY account_api_keys_select ON account_api_keys FOR SELECT USING (
  is_account_member(account_id, 'admin')
);

DROP POLICY IF EXISTS account_api_keys_insert ON account_api_keys;
CREATE POLICY account_api_keys_insert ON account_api_keys FOR INSERT WITH CHECK (
  is_account_member(account_id, 'admin')
);

DROP POLICY IF EXISTS account_api_keys_update ON account_api_keys;
CREATE POLICY account_api_keys_update ON account_api_keys FOR UPDATE USING (
  is_account_member(account_id, 'admin')
);

COMMENT ON TABLE account_api_keys IS
  'Per-account API keys for non-browser clients (MCP server, automation platforms). Only the SHA-256 hash of each key is stored; the plaintext is shown once at creation. Authenticates the /api/v1/* surface only.';

COMMENT ON COLUMN account_api_keys.key_prefix IS
  'Leading segment of the plaintext key, for identification in the UI. Not a secret and not sufficient to authenticate.';
