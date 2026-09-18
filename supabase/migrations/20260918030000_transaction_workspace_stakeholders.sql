-- ============================================================
-- 20260918030000_transaction_workspace_stakeholders.sql — Phase 2 of
-- the Transaction Workspace: controlled collaboration.
--
-- A stakeholder is a person on one side of one deal — buyer, seller,
-- advocate, banker, broker, witness. They never get a login. What
-- they get is a per-recipient tokenised link (`deal_share_links`)
-- that resolves, through the one visibility resolver in
-- src/lib/deals/visibility.ts, to the slice of the transaction their
-- side may see. Every open and every document fetch is logged; a
-- sensitive link can demand a per-token OTP that is hashed here and
-- never becomes a Supabase Auth user.
--
-- Visibility lives on the rows themselves: every event, milestone and
-- document carries one, defaulting to `internal` so nothing filed
-- before Phase 2 leaks by default. deal_events stays immutable, so an
-- event's visibility is fixed at insert.
--
-- Purely additive: new tables and nullable-or-defaulted columns. The
-- widened deal_events CHECK is the next migration, held until merge.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS deal_stakeholders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  role TEXT NOT NULL
    CHECK (role IN ('buyer', 'seller', 'advocate', 'banker', 'broker', 'witness', 'other')),
  side TEXT NOT NULL
    CHECK (side IN ('buyer', 'seller', 'internal')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_stakeholders_deal
  ON deal_stakeholders (deal_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deal_stakeholders_account
  ON deal_stakeholders (account_id);
CREATE INDEX IF NOT EXISTS idx_deal_stakeholders_contact
  ON deal_stakeholders (contact_id)
  WHERE contact_id IS NOT NULL;

ALTER TABLE deal_stakeholders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_stakeholders_select ON deal_stakeholders;
CREATE POLICY deal_stakeholders_select ON deal_stakeholders FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS deal_stakeholders_modify ON deal_stakeholders;
CREATE POLICY deal_stakeholders_modify ON deal_stakeholders FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP TRIGGER IF EXISTS set_updated_at ON deal_stakeholders;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deal_stakeholders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- Share links. Only the SHA-256 of the token is stored, as
-- account_invitations does: a database read never yields a usable
-- link. `token_prefix` is the first characters, kept so the agent can
-- tell links apart in the UI.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  stakeholder_id UUID NOT NULL REFERENCES deal_stakeholders(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  otp_required BOOLEAN NOT NULL DEFAULT FALSE,
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_share_links_deal
  ON deal_share_links (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_share_links_stakeholder
  ON deal_share_links (stakeholder_id);
CREATE INDEX IF NOT EXISTS idx_deal_share_links_account
  ON deal_share_links (account_id);

ALTER TABLE deal_share_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_share_links_select ON deal_share_links;
CREATE POLICY deal_share_links_select ON deal_share_links FOR SELECT USING (
  is_account_member(account_id)
);

-- Members mint and revoke; the public resolver runs service-role.
DROP POLICY IF EXISTS deal_share_links_insert ON deal_share_links;
CREATE POLICY deal_share_links_insert ON deal_share_links FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS deal_share_links_update ON deal_share_links;
CREATE POLICY deal_share_links_update ON deal_share_links FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON deal_share_links;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deal_share_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- Access log. Written service-role by the public routes; members read
-- their own account's rows. Nothing here is ever updated or deleted
-- by a client.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_share_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  link_id UUID NOT NULL REFERENCES deal_share_links(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN (
    'view', 'denied', 'otp_sent', 'otp_verified', 'otp_failed',
    'document_view', 'document_denied'
  )),
  document_id UUID REFERENCES deal_documents(id) ON DELETE SET NULL,
  ip_hash TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_share_access_log_link
  ON deal_share_access_log (link_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_share_access_log_account
  ON deal_share_access_log (account_id, created_at DESC);

ALTER TABLE deal_share_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_share_access_log_select ON deal_share_access_log;
CREATE POLICY deal_share_access_log_select ON deal_share_access_log FOR SELECT USING (
  is_account_member(account_id)
);

REVOKE ALL PRIVILEGES ON deal_share_access_log FROM anon, authenticated;
GRANT SELECT ON deal_share_access_log TO authenticated;

-- ------------------------------------------------------------
-- OTP challenges for sensitive links. The code is hashed; the row is
-- service-role only. Verification returns a short-lived signed unlock
-- bound to the link — never a session, never an auth.users row.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_share_otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID NOT NULL REFERENCES deal_share_links(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_share_otp_link
  ON deal_share_otp_challenges (link_id, created_at DESC);

ALTER TABLE deal_share_otp_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON deal_share_otp_challenges FROM anon, authenticated;

-- ------------------------------------------------------------
-- Visibility on the rows a link can reveal. Default internal.
-- ------------------------------------------------------------
ALTER TABLE deal_events
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('internal', 'buyer_side', 'seller_side', 'all_stakeholders'));

ALTER TABLE deal_milestones
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('internal', 'buyer_side', 'seller_side', 'all_stakeholders'));

ALTER TABLE deal_documents
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('internal', 'buyer_side', 'seller_side', 'all_stakeholders'));

COMMENT ON COLUMN deal_events.visibility IS
  'Who may see this entry through a stakeholder link. Fixed at insert; deal_events is immutable.';
COMMENT ON TABLE deal_share_links IS
  'Per-stakeholder tokenised links into a transaction. Token stored as SHA-256 only; expiry capped at 30 days; revocable; every open logged in deal_share_access_log.';
