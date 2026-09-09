ALTER TABLE follow_up_nudges
  ADD COLUMN IF NOT EXISTS agent_disposition TEXT
    CHECK (agent_disposition IN ('checkin_sent', 'considering', 'snoozed', 'cold')),
  ADD COLUMN IF NOT EXISTS disposition_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN follow_up_nudges.agent_disposition IS
  'Most recent disposition selected by an agent from a follow-up radar card.';
