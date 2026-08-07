-- ============================================================
-- 210_requirement_share_links.sql
--
-- Interactive co-broker requirement shares. The requirements page
-- already builds a copy-paste digest (src/lib/requirements/share.ts)
-- but the receiving agent has nowhere to act on it: they read the
-- brief on their personal WhatsApp and, if they have a matching
-- listing, forward it back as free text the sharing agent must
-- qualify by hand.
--
-- A share link is minted per requirement from the share dialog and
-- rides the message as /req/<token>. The public page shows the brief
-- (masked or full, frozen at mint time) and lets the co-broker respond
-- in place: submit a matching listing through the existing /list
-- funnel, or jump to the account's engine WhatsApp quoting the
-- REQ-XXXX reference, where the external listing intake bot takes
-- over. Either way the response lands as a Pending-Review property
-- tied back to the requirement.
--
-- Like property_share_grants, a link expires, can be revoked, and
-- every open is counted. No anon policy on purpose — public reads are
-- service-role, scoped by token.
-- ============================================================

CREATE TABLE IF NOT EXISTS requirement_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The requirement IS the contact (briefs live as columns on
  -- contacts) — the link dies with it.
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- Who shared it; kept when the profile goes so history survives.
  -- Also authors the response note on the requirement contact.
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  token TEXT NOT NULL UNIQUE,
  -- What the public page reveals, frozen at mint time: masked shows
  -- the brief under its REQ- reference, full includes the client name.
  mode TEXT NOT NULL DEFAULT 'masked' CHECK (mode IN ('full', 'masked')),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The public resolve path is token -> row, on every /req render.
CREATE INDEX IF NOT EXISTS idx_requirement_share_links_token
  ON requirement_share_links (token);

-- The inbound webhook resolves REQ-XXXX references against an
-- account's live links; the dialog lists links per requirement.
CREATE INDEX IF NOT EXISTS idx_requirement_share_links_account
  ON requirement_share_links (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_requirement_share_links_contact
  ON requirement_share_links (contact_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON requirement_share_links;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON requirement_share_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE requirement_share_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS requirement_share_links_select ON requirement_share_links;
CREATE POLICY requirement_share_links_select ON requirement_share_links FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS requirement_share_links_insert ON requirement_share_links;
CREATE POLICY requirement_share_links_insert ON requirement_share_links FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP POLICY IF EXISTS requirement_share_links_update ON requirement_share_links;
CREATE POLICY requirement_share_links_update ON requirement_share_links FOR UPDATE USING (
  is_account_member(account_id, 'agent')
);

-- A web submission made from the /req page carries the link it
-- answered, so the resulting Pending-Review property can be tied back
-- to the requirement at verification time.
ALTER TABLE public_listing_submissions
  ADD COLUMN IF NOT EXISTS requirement_link_id UUID REFERENCES requirement_share_links(id) ON DELETE SET NULL;

-- A WhatsApp intake session started by quoting REQ-XXXX carries the
-- link the same way. A column, not a draft_data key — the AI draft
-- merge rewrites draft_data wholesale and would drop it.
ALTER TABLE property_draft_sessions
  ADD COLUMN IF NOT EXISTS requirement_link_id UUID REFERENCES requirement_share_links(id) ON DELETE SET NULL;
