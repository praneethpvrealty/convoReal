-- Add is_archived flag to conversations so agents can archive threads
-- without deleting them. Archived conversations are hidden from the main
-- list and surfaced only when the "Archived" filter is selected.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

-- Index for fast filtering by archived state
CREATE INDEX IF NOT EXISTS conversations_is_archived_idx
  ON conversations (is_archived);
