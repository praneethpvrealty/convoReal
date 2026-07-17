-- ============================================================
-- 139_journey_created_by_fix.sql
-- Fix: journey inserts failed with an FK violation on created_by.
--
-- Migration 131 declared journey_items.created_by and
-- journey_events.created_by as REFERENCES profiles(id) — but
-- profiles.id is a standalone UUID (profiles.user_id is the auth
-- uid, see migration 001), while the app passes auth.uid() as
-- created_by. Every insert with a non-null created_by therefore
-- violated the FK and the Journey page reported "Nothing was
-- added." Re-point both FKs at auth.users(id), matching the
-- created_by convention used elsewhere (migration 077).
-- ============================================================

-- Defensive: null out any value that wouldn't satisfy the new FK
-- (in practice none exist — the old FK rejected every insert).
UPDATE journey_items SET created_by = NULL
  WHERE created_by IS NOT NULL
    AND created_by NOT IN (SELECT id FROM auth.users);
UPDATE journey_events SET created_by = NULL
  WHERE created_by IS NOT NULL
    AND created_by NOT IN (SELECT id FROM auth.users);

ALTER TABLE journey_items
  DROP CONSTRAINT IF EXISTS journey_items_created_by_fkey;
ALTER TABLE journey_items
  ADD CONSTRAINT journey_items_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE journey_events
  DROP CONSTRAINT IF EXISTS journey_events_created_by_fkey;
ALTER TABLE journey_events
  ADD CONSTRAINT journey_events_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN journey_items.created_by IS
  'auth.users.id of the agent who added this pair (fixed from profiles.id in migration 139).';
COMMENT ON COLUMN journey_events.created_by IS
  'auth.users.id of the acting agent (fixed from profiles.id in migration 139).';
