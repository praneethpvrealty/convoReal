ALTER TABLE journey_stage_notes
  ADD COLUMN stage_name TEXT,
  ADD COLUMN stage_color TEXT;

UPDATE journey_stage_notes notes
SET
  stage_name = stages.name,
  stage_color = stages.color
FROM journey_stages stages
WHERE stages.id = notes.stage_id;

ALTER TABLE journey_stage_notes
  ALTER COLUMN stage_name SET NOT NULL,
  ALTER COLUMN stage_id DROP NOT NULL;

ALTER TABLE journey_stage_notes
  DROP CONSTRAINT journey_stage_notes_stage_id_fkey,
  ADD CONSTRAINT journey_stage_notes_stage_id_fkey
    FOREIGN KEY (stage_id)
    REFERENCES journey_stages(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_journey_stage_notes_item_id
  ON journey_stage_notes (item_id);
CREATE INDEX IF NOT EXISTS idx_journey_stage_notes_stage_id
  ON journey_stage_notes (stage_id)
  WHERE stage_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journey_stage_notes_created_by
  ON journey_stage_notes (created_by)
  WHERE created_by IS NOT NULL;

DROP POLICY IF EXISTS journey_stage_notes_insert ON journey_stage_notes;
CREATE POLICY journey_stage_notes_insert
  ON journey_stage_notes FOR INSERT
  TO authenticated
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND created_by = (SELECT auth.uid())
    AND created_by_name IS NOT DISTINCT FROM (
      SELECT profiles.full_name
      FROM profiles
      WHERE profiles.account_id = journey_stage_notes.account_id
        AND profiles.user_id = (SELECT auth.uid())
      LIMIT 1
    )
    AND EXISTS (
      SELECT 1 FROM journey_items
      WHERE journey_items.id = journey_stage_notes.item_id
        AND journey_items.account_id = journey_stage_notes.account_id
    )
    AND EXISTS (
      SELECT 1 FROM journey_stages
      WHERE journey_stages.id = journey_stage_notes.stage_id
        AND journey_stages.account_id = journey_stage_notes.account_id
        AND journey_stages.name = journey_stage_notes.stage_name
        AND journey_stages.color IS NOT DISTINCT FROM journey_stage_notes.stage_color
    )
  );

COMMENT ON COLUMN journey_stage_notes.stage_name IS
  'Immutable stage-name snapshot retained if the stage is renamed or deleted.';
COMMENT ON COLUMN journey_stage_notes.stage_color IS
  'Immutable stage-color snapshot retained if the stage is renamed or deleted.';
