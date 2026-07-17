-- ============================================================
-- 131_journey_mindmap.sql
-- Journey Mind Map — per-(contact, property) funnel tracking.
--
-- Powers the /journey canvas: a buyer's card fans out to every
-- property shared with them, and each property flows left-to-right
-- through customisable stages (Shared → Shortlisted → Visited →
-- Owner Meeting → Token & Legal → Registration → Brokerage Paid),
-- recording WHERE it dropped out and WHY. The same rows read in
-- reverse give the seller view: a property fans out to every
-- interested contact.
--
-- NOT the same thing as pipelines/deals (kanban of one card per
-- deal). A journey tracks the full property×contact matrix for a
-- single relationship, including the discarded branches — that's
-- what the mind map renders and the kanban can't.
--
--   journey_stages  — account-level ordered stage list (customisable;
--                     seeded by the app on first visit, like pipelines)
--   journey_items   — one row per contact×property pair; stage_id is
--                     the FURTHEST stage reached; status 'dropped'
--                     means it died AT that stage, with drop_reason
--   journey_events  — append-only audit trail (added / advanced /
--                     moved / dropped / reactivated) rendered as the
--                     item's timeline in the detail sheet
-- ============================================================

-- Ordered, customisable stage list per account.
CREATE TABLE IF NOT EXISTS journey_stages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journey_stages_account
  ON journey_stages(account_id, position);

ALTER TABLE journey_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journey_stages_select ON journey_stages;
CREATE POLICY journey_stages_select ON journey_stages FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS journey_stages_modify ON journey_stages;
CREATE POLICY journey_stages_modify ON journey_stages FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP TRIGGER IF EXISTS set_journey_stages_updated_at ON journey_stages;
CREATE TRIGGER set_journey_stages_updated_at BEFORE UPDATE ON journey_stages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- One row per contact×property pair in a journey.
-- stage_id = furthest stage this pair has reached. RESTRICT on the
-- stage FK so a stage with live items can't be deleted out from
-- under them (the stage editor blocks this in the UI too).
CREATE TABLE IF NOT EXISTS journey_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES journey_stages(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'dropped')),
  drop_reason TEXT,
  dropped_at TIMESTAMPTZ,
  notes TEXT,
  -- auth uid of the acting agent (NOT profiles.id — that's a
  -- standalone UUID; see migration 139 which fixed this).
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, contact_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_journey_items_contact
  ON journey_items(account_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_journey_items_property
  ON journey_items(account_id, property_id);
CREATE INDEX IF NOT EXISTS idx_journey_items_stage
  ON journey_items(stage_id);

ALTER TABLE journey_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journey_items_select ON journey_items;
CREATE POLICY journey_items_select ON journey_items FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS journey_items_modify ON journey_items;
CREATE POLICY journey_items_modify ON journey_items FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP TRIGGER IF EXISTS set_journey_items_updated_at ON journey_items;
CREATE TRIGGER set_journey_items_updated_at BEFORE UPDATE ON journey_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Append-only history per item. from/to stage ids are SET NULL on
-- stage deletion so history survives a stage cleanup even though
-- live items block it (RESTRICT above only guards journey_items).
CREATE TABLE IF NOT EXISTS journey_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES journey_items(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('added', 'advanced', 'moved', 'dropped', 'reactivated')),
  from_stage_id UUID REFERENCES journey_stages(id) ON DELETE SET NULL,
  to_stage_id UUID REFERENCES journey_stages(id) ON DELETE SET NULL,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journey_events_item
  ON journey_events(item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_journey_events_account
  ON journey_events(account_id);

ALTER TABLE journey_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journey_events_select ON journey_events;
CREATE POLICY journey_events_select ON journey_events FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS journey_events_modify ON journey_events;
CREATE POLICY journey_events_modify ON journey_events FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

COMMENT ON TABLE journey_stages IS
  'Customisable ordered funnel stages for the Journey mind map (per account). Seeded app-side with Shared → Shortlisted → Visited → Owner Meeting → Token & Legal → Registration → Brokerage Paid.';
COMMENT ON TABLE journey_items IS
  'One contact×property pair on the Journey mind map. stage_id = furthest stage reached; status dropped = exited at that stage (drop_reason says why).';
COMMENT ON TABLE journey_events IS
  'Append-only stage-transition history for journey_items; rendered as the timeline in the item detail sheet.';
