-- ============================================================
-- 20260918050000_transaction_workspace_updates.sql — Phase 3 of the
-- Transaction Workspace: publishing updates.
--
-- An update is a message the agent composes for one side of a deal
-- from the milestones and timeline entries that side may already see.
-- Publishing freezes it: `deal_updates` is insert-only, like
-- deal_events, so what a buyer was told on the 18th reads the same on
-- the 30th whatever the checklist looks like by then. A correction is
-- a new update that names the one it supersedes; the original stays.
--
-- Delivery is per recipient (`deal_update_recipients`): the channel
-- the agent chose, how it actually went out, and three timestamps
-- recorded separately — sent, opened, acknowledged — because a link
-- notice that was sent is not one that was read, and one that was
-- read is not one the buyer agreed with.
--
-- Purely additive: two new tables. The widened deal_events CHECK is
-- the next migration, held until merge.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS deal_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  headline TEXT NOT NULL,
  body TEXT,
  visibility TEXT NOT NULL
    CHECK (visibility IN ('buyer_side', 'seller_side', 'all_stakeholders')),
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  supersedes_update_id UUID REFERENCES deal_updates(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'web'
    CHECK (source IN ('web', 'mobile', 'api', 'system')),
  published_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  published_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_updates_deal
  ON deal_updates (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_updates_account
  ON deal_updates (account_id, created_at DESC);

ALTER TABLE deal_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_updates_select ON deal_updates;
CREATE POLICY deal_updates_select ON deal_updates FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS deal_updates_insert ON deal_updates;
CREATE POLICY deal_updates_insert ON deal_updates FOR INSERT
  TO authenticated
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND published_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM deals
      WHERE deals.id = deal_updates.deal_id
        AND deals.account_id = deal_updates.account_id
    )
  );

REVOKE ALL PRIVILEGES ON deal_updates FROM anon, authenticated;
GRANT SELECT, INSERT ON deal_updates TO authenticated;

CREATE OR REPLACE FUNCTION deal_updates_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'deal_updates are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM deals WHERE deals.id = OLD.deal_id) THEN
    RAISE EXCEPTION 'deal_updates are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS deal_updates_immutable_trigger ON deal_updates;
CREATE TRIGGER deal_updates_immutable_trigger
  BEFORE UPDATE OR DELETE ON deal_updates
  FOR EACH ROW EXECUTE FUNCTION deal_updates_immutable();

COMMENT ON TABLE deal_updates IS
  'Published Transaction Workspace updates. A durable snapshot: SELECT/INSERT only, UPDATE and DELETE refused by trigger except the cascade from a deleted deal. A correction is a new row naming supersedes_update_id.';

-- ------------------------------------------------------------
-- Recipients. One row per stakeholder an update went to, carrying the
-- link it was addressed through and the three separately recorded
-- facts about it. Members write status through the routes; the public
-- portal writes opened_at and acknowledged_at service-role, scoped by
-- the link it resolved.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_update_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  update_id UUID NOT NULL REFERENCES deal_updates(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  stakeholder_id UUID NOT NULL REFERENCES deal_stakeholders(id) ON DELETE CASCADE,
  link_id UUID REFERENCES deal_share_links(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  channel TEXT NOT NULL
    CHECK (channel IN ('engine_whatsapp', 'personal_whatsapp', 'portal_only')),
  delivery_mode TEXT
    CHECK (delivery_mode IN ('free_form', 'template', 'handoff', 'portal')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  failed_reason TEXT,
  link_ttl_ms INTEGER,
  link_otp_required BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at TIMESTAMPTZ,
  link_delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_via TEXT
    CHECK (acknowledged_via IN ('portal', 'whatsapp')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_update_recipients_update
  ON deal_update_recipients (update_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deal_update_recipients_link
  ON deal_update_recipients (link_id)
  WHERE link_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_update_recipients_contact
  ON deal_update_recipients (account_id, contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_update_recipients_account
  ON deal_update_recipients (account_id);

ALTER TABLE deal_update_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_update_recipients_select ON deal_update_recipients;
CREATE POLICY deal_update_recipients_select ON deal_update_recipients FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS deal_update_recipients_insert ON deal_update_recipients;
CREATE POLICY deal_update_recipients_insert ON deal_update_recipients FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS deal_update_recipients_update ON deal_update_recipients;
CREATE POLICY deal_update_recipients_update ON deal_update_recipients FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON deal_update_recipients;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deal_update_recipients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE deal_update_recipients IS
  'Per-recipient delivery of a published update: channel, how it went out, and sent / opened / acknowledged recorded separately.';
