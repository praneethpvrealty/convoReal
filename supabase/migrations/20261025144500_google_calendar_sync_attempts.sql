ALTER TABLE google_calendar_connections
  ADD COLUMN IF NOT EXISTS last_attempted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_google_calendar_connections_attempt
  ON google_calendar_connections (last_attempted_at NULLS FIRST)
  WHERE status <> 'token_expired';

COMMENT ON COLUMN google_calendar_connections.last_attempted_at IS
  'When the sync last started for this connection, success or not. /api/cron/google-calendar-sync picks the least recently attempted connections first, so connections that keep failing cannot hold every slot of a run.';
