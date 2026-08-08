-- ============================================================
-- 218_whatsapp_groups.sql
-- WhatsApp Groups (Cloud API Groups, 2026).
--
-- Eligibility, before anything here is useful: the Groups API is open
-- only to numbers on an Official Business Account. A WABA that is not
-- an OBA gets an error on every call, which is why `groups_enabled`
-- lives on whatsapp_config and defaults FALSE — the UI has to be able
-- to stay hidden rather than offer a feature the number cannot use.
--
-- Meta's constraints, mirrored here so nothing downstream re-derives
-- them: 8 participants per group, 10,000 groups per business number,
-- invite-link joining only, and no interactive messages (buttons,
-- lists, flows) — which is why the bot/funnel path must skip group
-- conversations rather than answer into them.
--
-- Creation is ASYNCHRONOUS. POST /{phone_number_id}/groups returns an
-- invite link and a request_id; the real group_id arrives later on the
-- group_lifecycle_update webhook. So a row starts as 'pending' with no
-- wa_group_id and is completed by the webhook.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Groups
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Meta's group id. Null until the creation webhook lands.
  wa_group_id TEXT,
  -- Correlates our POST with the webhook that completes it.
  request_id TEXT,
  subject TEXT NOT NULL,
  description TEXT,
  invite_link TEXT,
  join_approval_mode TEXT NOT NULL DEFAULT 'off'
    CHECK (join_approval_mode IN ('off', 'admin_approval')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'deleted', 'failed')),
  -- Why a create failed, straight from the webhook's errors array.
  error_message TEXT,
  participant_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- One row per Meta group. Partial: many rows may sit at NULL while
-- their creation webhook is outstanding, and those are not duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_groups_wa_id
  ON whatsapp_groups(wa_group_id)
  WHERE wa_group_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_groups_request
  ON whatsapp_groups(request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_account
  ON whatsapp_groups(account_id, status);

-- ------------------------------------------------------------
-- 2. Participants
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_group_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
  -- The participant's WhatsApp id (phone in E.164 without '+').
  wa_id TEXT NOT NULL,
  -- Matched to a contact when we know them. Someone can join by link
  -- without ever having been a lead, so this stays nullable.
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  -- Set rather than deleted: who left a deal group and when is history
  -- worth keeping.
  left_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_group_participants_unique
  ON whatsapp_group_participants(group_id, wa_id);

CREATE INDEX IF NOT EXISTS idx_group_participants_active
  ON whatsapp_group_participants(group_id)
  WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_group_participants_contact
  ON whatsapp_group_participants(contact_id)
  WHERE contact_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Conversations can now be about a group
--
-- `contact_id` was NOT NULL, which encoded "every thread is one
-- person". A group thread has no single contact, so the column becomes
-- nullable and a CHECK enforces that a conversation is about exactly
-- one of the two — never both, never neither.
-- ------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES whatsapp_groups(id) ON DELETE CASCADE;

ALTER TABLE conversations ALTER COLUMN contact_id DROP NOT NULL;

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_subject_present;
ALTER TABLE conversations ADD CONSTRAINT conversations_subject_present
  CHECK (
    (contact_id IS NOT NULL AND group_id IS NULL)
    OR (contact_id IS NULL AND group_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_group
  ON conversations(group_id)
  WHERE group_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4. Messages carry their group sender
--
-- In a 1:1 thread the conversation identifies who wrote an inbound
-- message. In a group it does not — any of the 8 participants could
-- have. Without this every inbound group message would render as
-- "them".
-- ------------------------------------------------------------
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sender_wa_id TEXT,
  ADD COLUMN IF NOT EXISTS sender_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 5. Feature gate
-- ------------------------------------------------------------
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS groups_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN whatsapp_config.groups_enabled IS
  'Groups API requires an Official Business Account. Leave FALSE unless Meta has confirmed OBA status for this number — every groups call fails otherwise.';

-- ------------------------------------------------------------
-- 6. updated_at triggers
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_groups;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_group_participants;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_group_participants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 7. RLS
-- ------------------------------------------------------------
ALTER TABLE whatsapp_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_group_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read their account's groups" ON whatsapp_groups;
CREATE POLICY "Members read their account's groups" ON whatsapp_groups
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "Agents manage their account's groups" ON whatsapp_groups;
CREATE POLICY "Agents manage their account's groups" ON whatsapp_groups
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Members read their account's participants" ON whatsapp_group_participants;
CREATE POLICY "Members read their account's participants" ON whatsapp_group_participants
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "Agents manage their account's participants" ON whatsapp_group_participants;
CREATE POLICY "Agents manage their account's participants" ON whatsapp_group_participants
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- The inbox reads groups live, same as messages and conversations.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'whatsapp_groups'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_groups;
  END IF;
END $$;
