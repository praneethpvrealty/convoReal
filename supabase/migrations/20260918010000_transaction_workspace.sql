-- ============================================================
-- 20260918010000_transaction_workspace.sql — Phase 1 of the
-- Transaction Workspace: the existing `deals` row becomes the closing
-- record, connected to the Journey it came from, with an immutable
-- timeline, milestones, deal-linked tasks and document lifecycle.
--
-- Product name: Transaction Workspace. Code identifiers stay `deal_*`,
-- as Portfolio's stay `den_*`. `deal_rooms` (migration 136) remains the
-- Owners Den bid room and is only LINKED from here: a Den-backed deal
-- derives its token money from `token_escrows` rather than carrying a
-- second copy of the amount.
--
-- Purely additive: new tables, nullable columns and one new function.
-- The behaviour-changing half (a trigger on `deals` and a widened
-- journey_events CHECK) is the next migration, held until merge.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- Deal groups — a lightweight bundle for linked purchases (one buyer,
-- two plots). Each member stays an independent deal with its own
-- seller, milestones, documents and terms; the group only exists to
-- show combined progress. No parent/child deal model.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_groups_account
  ON deal_groups (account_id, created_at DESC);

ALTER TABLE deal_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_groups_select ON deal_groups;
CREATE POLICY deal_groups_select ON deal_groups FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS deal_groups_modify ON deal_groups;
CREATE POLICY deal_groups_modify ON deal_groups FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP TRIGGER IF EXISTS set_updated_at ON deal_groups;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deal_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- deals — provenance, grouping, Den linkage and internal financials.
--
-- The financial columns are INTERNAL ONLY. They are deny-listed from
-- every external representation in src/lib/deals/financials.ts and
-- never selected by /api/v1 or a public route.
-- ------------------------------------------------------------
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS source_journey_item_id UUID
    REFERENCES journey_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deal_group_id UUID
    REFERENCES deal_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deal_room_id UUID
    REFERENCES deal_rooms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agreed_consideration NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS registered_consideration NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS other_component NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS token_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS token_received_at DATE,
  ADD COLUMN IF NOT EXISTS token_instrument_ref TEXT,
  ADD COLUMN IF NOT EXISTS tds_status TEXT
    CHECK (tds_status IS NULL OR tds_status IN ('not_applicable', 'expected', 'deducted', 'deposited')),
  ADD COLUMN IF NOT EXISTS tds_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS payment_instrument_refs TEXT,
  ADD COLUMN IF NOT EXISTS brokerage_received_amount NUMERIC(14,2);

-- One deal per journey item: conversion is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_source_journey_item
  ON deals (source_journey_item_id)
  WHERE source_journey_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deals_group
  ON deals (deal_group_id)
  WHERE deal_group_id IS NOT NULL;

-- One deal per Den room per account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_deal_room
  ON deals (account_id, deal_room_id)
  WHERE deal_room_id IS NOT NULL;

COMMENT ON COLUMN deals.source_journey_item_id IS
  'The journey item this deal was converted from. Provenance only; the journey keeps its own history.';
COMMENT ON COLUMN deals.deal_room_id IS
  'Owners Den bid room this deal closes. When set, token money is read from token_escrows and the token_* columns here are refused.';
COMMENT ON COLUMN deals.agreed_consideration IS
  'Internal only. Deny-listed from every external representation (src/lib/deals/financials.ts).';
COMMENT ON COLUMN deals.registered_consideration IS
  'Internal only. Deny-listed from every external representation (src/lib/deals/financials.ts).';

-- ------------------------------------------------------------
-- todos — a task can belong to a deal.
-- ------------------------------------------------------------
ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_todos_deal
  ON todos (deal_id)
  WHERE deal_id IS NOT NULL;

-- ------------------------------------------------------------
-- deal_events — the immutable timeline.
--
-- journey_events is documented as append-only but ships a FOR ALL
-- policy, so an agent holding the anon key and their JWT can rewrite
-- it through PostgREST. This table does not repeat that: the only
-- privileges are SELECT and INSERT, the INSERT policy pins the actor
-- to the caller, and a trigger refuses UPDATE and DELETE from any
-- role — including service_role — except the cascade that removes
-- the events together with their deal.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created',
    'converted_from_journey',
    'stage_changed',
    'financials_updated',
    'milestone_added',
    'milestone_updated',
    'task_added',
    'document_added',
    'document_status_changed',
    'document_superseded',
    'group_changed',
    'note_added'
  )),
  source TEXT NOT NULL DEFAULT 'web'
    CHECK (source IN ('web', 'mobile', 'api', 'system')),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name TEXT,
  title TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_events_deal
  ON deal_events (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_events_account
  ON deal_events (account_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_events_dedupe
  ON deal_events (deal_id, event_type, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE deal_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_events_select ON deal_events;
CREATE POLICY deal_events_select ON deal_events FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS deal_events_insert ON deal_events;
CREATE POLICY deal_events_insert ON deal_events FOR INSERT
  TO authenticated
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND actor_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM deals
      WHERE deals.id = deal_events.deal_id
        AND deals.account_id = deal_events.account_id
    )
  );

REVOKE ALL PRIVILEGES ON deal_events FROM anon, authenticated;
GRANT SELECT, INSERT ON deal_events TO authenticated;

CREATE OR REPLACE FUNCTION deal_events_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'deal_events are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- A cascade from the parent deal is the one delete that may pass:
  -- by the time it reaches this row the deal is already gone.
  IF EXISTS (SELECT 1 FROM deals WHERE deals.id = OLD.deal_id) THEN
    RAISE EXCEPTION 'deal_events are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS deal_events_immutable_trigger ON deal_events;
CREATE TRIGGER deal_events_immutable_trigger
  BEFORE UPDATE OR DELETE ON deal_events
  FOR EACH ROW EXECUTE FUNCTION deal_events_immutable();

COMMENT ON TABLE deal_events IS
  'Immutable Transaction Workspace timeline. SELECT/INSERT only; UPDATE and DELETE are refused by trigger except the cascade from a deleted deal.';

-- ------------------------------------------------------------
-- deal_milestones — the closing checklist, instantiated from the
-- templates in src/lib/deals/milestones.ts and then customised per
-- deal. Deliberately separate from pipeline_stages: completing a
-- milestone never moves the card, and moving the card never completes
-- a milestone.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  template_key TEXT,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  target_date DATE,
  completed_at TIMESTAMPTZ,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_milestones_deal
  ON deal_milestones (deal_id, position);
CREATE INDEX IF NOT EXISTS idx_deal_milestones_account
  ON deal_milestones (account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_milestones_template
  ON deal_milestones (deal_id, template_key)
  WHERE template_key IS NOT NULL;

ALTER TABLE deal_milestones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_milestones_select ON deal_milestones;
CREATE POLICY deal_milestones_select ON deal_milestones FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS deal_milestones_modify ON deal_milestones;
CREATE POLICY deal_milestones_modify ON deal_milestones FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP TRIGGER IF EXISTS set_updated_at ON deal_milestones;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deal_milestones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- deal_documents — lifecycle. NULL status means unlabelled, so the
-- Aadhaars already filed do not wake up as "drafts".
-- ------------------------------------------------------------
ALTER TABLE deal_documents
  ADD COLUMN IF NOT EXISTS status TEXT
    CHECK (status IS NULL OR status IN ('draft', 'reviewed', 'approved', 'executed')),
  ADD COLUMN IF NOT EXISTS superseded_by UUID
    REFERENCES deal_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at DATE;

CREATE INDEX IF NOT EXISTS idx_deal_documents_expiry
  ON deal_documents (account_id, expires_at)
  WHERE expires_at IS NOT NULL AND superseded_by IS NULL;

-- ------------------------------------------------------------
-- Index page aggregate — milestone progress per deal in SQL, so the
-- workspace list does not ship every milestone row to the browser.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION transaction_workspace_index(target_account_id UUID)
RETURNS TABLE (
  id UUID,
  title TEXT,
  status TEXT,
  value NUMERIC,
  currency TEXT,
  stage_name TEXT,
  stage_color TEXT,
  contact_name TEXT,
  property_title TEXT,
  property_unit_no TEXT,
  deal_group_id UUID,
  group_name TEXT,
  source_journey_item_id UUID,
  milestones_total INTEGER,
  milestones_done INTEGER,
  next_milestone_title TEXT,
  next_milestone_target_date DATE,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.title,
    d.status,
    d.value,
    d.currency,
    s.name,
    s.color,
    NULLIF(TRIM(CONCAT_WS(' ', c.name, c.second_name)), ''),
    p.title,
    p.unit_no,
    d.deal_group_id,
    g.name,
    d.source_journey_item_id,
    COALESCE(m.total, 0)::INTEGER,
    COALESCE(m.done, 0)::INTEGER,
    nm.title,
    nm.target_date,
    d.updated_at
  FROM deals d
  LEFT JOIN pipeline_stages s ON s.id = d.stage_id
  LEFT JOIN contacts c ON c.id = d.contact_id
  LEFT JOIN properties p ON p.id = d.property_id
  LEFT JOIN deal_groups g ON g.id = d.deal_group_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE dm.status IN ('completed', 'skipped')) AS done
    FROM deal_milestones dm
    WHERE dm.deal_id = d.id
  ) m ON TRUE
  LEFT JOIN LATERAL (
    SELECT dm.title, dm.target_date
    FROM deal_milestones dm
    WHERE dm.deal_id = d.id
      AND dm.status IN ('pending', 'in_progress')
    ORDER BY dm.position
    LIMIT 1
  ) nm ON TRUE
  WHERE d.account_id = target_account_id
    AND is_account_member(target_account_id)
  ORDER BY d.updated_at DESC;
$$;

REVOKE ALL ON FUNCTION transaction_workspace_index(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transaction_workspace_index(UUID) TO authenticated;
