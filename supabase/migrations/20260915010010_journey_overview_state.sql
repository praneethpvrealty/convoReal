CREATE TABLE IF NOT EXISTS journey_overview_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('buyer', 'property')),
  subject_id UUID NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'completed', 'paused', 'not_proceeding')),
  closure_reason TEXT,
  closed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, mode, subject_id),
  CHECK (
    (lifecycle_status = 'active' AND closed_at IS NULL)
    OR (lifecycle_status <> 'active' AND closed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_journey_overview_states_account_view
  ON journey_overview_states (
    account_id,
    mode,
    archived_at,
    lifecycle_status,
    sort_order
  );

DROP TRIGGER IF EXISTS set_journey_overview_states_updated_at
  ON journey_overview_states;
CREATE TRIGGER set_journey_overview_states_updated_at
  BEFORE UPDATE ON journey_overview_states
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE journey_overview_states ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON journey_overview_states
  TO authenticated;

DROP POLICY IF EXISTS journey_overview_states_select
  ON journey_overview_states;
CREATE POLICY journey_overview_states_select
  ON journey_overview_states FOR SELECT
  TO authenticated
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS journey_overview_states_insert
  ON journey_overview_states;
CREATE POLICY journey_overview_states_insert
  ON journey_overview_states FOR INSERT
  TO authenticated
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND (
      (
        mode = 'buyer'
        AND EXISTS (
          SELECT 1 FROM journey_items
          WHERE journey_items.account_id = journey_overview_states.account_id
            AND journey_items.contact_id = journey_overview_states.subject_id
        )
      )
      OR (
        mode = 'property'
        AND EXISTS (
          SELECT 1 FROM journey_items
          WHERE journey_items.account_id = journey_overview_states.account_id
            AND journey_items.property_id = journey_overview_states.subject_id
        )
      )
    )
  );

DROP POLICY IF EXISTS journey_overview_states_update
  ON journey_overview_states;
CREATE POLICY journey_overview_states_update
  ON journey_overview_states FOR UPDATE
  TO authenticated
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND (
      (
        mode = 'buyer'
        AND EXISTS (
          SELECT 1 FROM journey_items
          WHERE journey_items.account_id = journey_overview_states.account_id
            AND journey_items.contact_id = journey_overview_states.subject_id
        )
      )
      OR (
        mode = 'property'
        AND EXISTS (
          SELECT 1 FROM journey_items
          WHERE journey_items.account_id = journey_overview_states.account_id
            AND journey_items.property_id = journey_overview_states.subject_id
        )
      )
    )
  );

DROP POLICY IF EXISTS journey_overview_states_delete
  ON journey_overview_states;
CREATE POLICY journey_overview_states_delete
  ON journey_overview_states FOR DELETE
  TO authenticated
  USING (is_account_member(account_id, 'agent'));

COMMENT ON TABLE journey_overview_states IS
  'Persistent lifecycle, archive and manual-order state for one grouped buyer or property journey.';

CREATE TABLE IF NOT EXISTS journey_stage_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES journey_items(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES journey_stages(id) ON DELETE RESTRICT,
  note TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 1000),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journey_stage_notes_item_stage
  ON journey_stage_notes (account_id, item_id, stage_id, created_at DESC);

ALTER TABLE journey_stage_notes ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON journey_stage_notes TO authenticated;

DROP POLICY IF EXISTS journey_stage_notes_select ON journey_stage_notes;
CREATE POLICY journey_stage_notes_select
  ON journey_stage_notes FOR SELECT
  TO authenticated
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS journey_stage_notes_insert ON journey_stage_notes;
CREATE POLICY journey_stage_notes_insert
  ON journey_stage_notes FOR INSERT
  TO authenticated
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND EXISTS (
      SELECT 1 FROM journey_items
      WHERE journey_items.id = journey_stage_notes.item_id
        AND journey_items.account_id = journey_stage_notes.account_id
    )
    AND EXISTS (
      SELECT 1 FROM journey_stages
      WHERE journey_stages.id = journey_stage_notes.stage_id
        AND journey_stages.account_id = journey_stage_notes.account_id
    )
  );

COMMENT ON TABLE journey_stage_notes IS
  'Append-only dated comments attached to one property/contact journey branch at one stage.';
