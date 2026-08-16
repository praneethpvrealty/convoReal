-- ============================================================
-- 288_contact_parties.sql — several people, one requirement.
--
-- A husband and wife buying together, or two or three people from one
-- company, are not duplicates and must never be merged: merging is for
-- ONE person recorded twice (see src/lib/contacts/duplicate-key.ts),
-- and collapsing two real people would destroy the second person's
-- number, consent, language and WhatsApp thread.
--
-- But every unit in the Engine is keyed to a person, so a couple on one
-- deal gets two of everything. On 16 Aug a husband and wife were both
-- carded as "quiet for 28 days" and "quiet for 19 days" on the SAME
-- listing, and both were sent the enquiry check-in — because silence is
-- measured per WhatsApp thread, and a reply from one of them does not
-- reset the other's clock. The deal was never quiet.
--
-- A party is the missing unit: contacts stay who we MESSAGE, the party
-- becomes who we CHASE AND COUNT. Nothing about a contact row changes,
-- so this is additive and reversible.
--
--   contact_parties        — the household / company / set of partners
--   contact_party_members  — who is in it, and who we address by default
--
-- A contact belongs to at most one party (the UNIQUE below). That is a
-- deliberate simplification: it makes "which party is this lead in?" a
-- lookup rather than a judgement call, and every dedup downstream can
-- key on it without tie-breaking.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Optional label. Left null the party is named from its members, so
  -- an agent never has to invent "The Ravi Household" to link two people.
  name TEXT,
  kind TEXT NOT NULL DEFAULT 'household'
    CHECK (kind IN ('household', 'company', 'partners')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_parties_account
  ON contact_parties (account_id);

CREATE TABLE IF NOT EXISTS contact_party_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  party_id UUID NOT NULL REFERENCES contact_parties(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  -- Who the bot addresses when it has one thing to say to the party.
  -- The others still receive anything sent to them directly, and a
  -- reply from ANY member counts as the party having replied.
  is_primary BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_party_members_party
  ON contact_party_members (account_id, party_id);

-- At most one primary per party. A partial unique index rather than a
-- trigger: the promote path is "clear then set", and this makes a
-- half-applied promotion impossible rather than merely unlikely.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_party_one_primary
  ON contact_party_members (party_id) WHERE is_primary;

DROP TRIGGER IF EXISTS set_updated_at ON contact_parties;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contact_parties
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON contact_party_members;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contact_party_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE contact_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_party_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_parties_select ON contact_parties;
CREATE POLICY contact_parties_select ON contact_parties FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS contact_parties_modify ON contact_parties;
CREATE POLICY contact_parties_modify ON contact_parties FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP POLICY IF EXISTS contact_party_members_select ON contact_party_members;
CREATE POLICY contact_party_members_select ON contact_party_members FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS contact_party_members_modify ON contact_party_members;
CREATE POLICY contact_party_members_modify ON contact_party_members FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);
