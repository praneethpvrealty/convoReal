-- ============================================================
-- Calendar revamp: typed events, team assignment, capture
-- provenance (web / WhatsApp / voice), agent-facing reminders,
-- and daily WhatsApp schedule digests.
--
-- appointments.event_type powers color-coded team calendars
-- (site visits, calls, follow-ups, document work). assigned_to
-- lets a manager put an event on an agent's lane while user_id
-- keeps recording who created it. source + transcript preserve
-- how the event was logged (typed, WhatsApp text, voice note).
-- ============================================================

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'meeting'
    CHECK (event_type IN ('site_visit', 'call', 'follow_up', 'document', 'meeting', 'other')),
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web'
    CHECK (source IN ('web', 'whatsapp', 'voice', 'system')),
  ADD COLUMN IF NOT EXISTS transcript TEXT,
  ADD COLUMN IF NOT EXISTS agent_reminder_sent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS overdue_nudge_sent BOOLEAN NOT NULL DEFAULT false;

-- Existing rows: the creator is the assignee.
UPDATE appointments SET assigned_to = user_id WHERE assigned_to IS NULL;

ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web'
    CHECK (source IN ('web', 'whatsapp', 'voice', 'system'));

UPDATE todos SET assigned_to = user_id WHERE assigned_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_assigned_to ON appointments(assigned_to);
CREATE INDEX IF NOT EXISTS idx_appointments_start_time ON appointments(start_time);
CREATE INDEX IF NOT EXISTS idx_todos_assigned_to ON todos(assigned_to);

-- One row per (user, IST calendar day) — dedupes the morning
-- WhatsApp schedule digest across cron ticks.
CREATE TABLE IF NOT EXISTS agent_digest_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  digest_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, digest_date)
);

ALTER TABLE agent_digest_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view own account digest log" ON agent_digest_log;
CREATE POLICY "Members can view own account digest log" ON agent_digest_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_id = agent_digest_log.account_id
    )
  );

COMMENT ON COLUMN appointments.event_type IS
  'Activity category for team calendar lanes/colors: site_visit, call, follow_up, document, meeting, other.';
COMMENT ON COLUMN appointments.assigned_to IS
  'The team member whose calendar this event sits on. Defaults to the creator (user_id).';
COMMENT ON COLUMN appointments.source IS
  'How the event was captured: web form, whatsapp text to the owner bot, voice note, or system-generated.';
COMMENT ON COLUMN appointments.transcript IS
  'Verbatim transcript of the voice note or original WhatsApp text the event was parsed from.';
