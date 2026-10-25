CREATE TABLE IF NOT EXISTS google_calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  google_email TEXT,
  calendar_id TEXT,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'token_expired', 'error')),
  last_error TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS google_calendar_connections_user_key
  ON google_calendar_connections (user_id);

CREATE INDEX IF NOT EXISTS idx_google_calendar_connections_account
  ON google_calendar_connections (account_id);

CREATE INDEX IF NOT EXISTS idx_google_calendar_connections_due
  ON google_calendar_connections (last_synced_at NULLS FIRST)
  WHERE status <> 'token_expired';

CREATE TABLE IF NOT EXISTS google_calendar_event_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_uid TEXT NOT NULL,
  google_event_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS google_calendar_event_links_source_key
  ON google_calendar_event_links (user_id, source_uid);

CREATE INDEX IF NOT EXISTS idx_google_calendar_event_links_account
  ON google_calendar_event_links (account_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at'
      AND tgrelid = 'public.google_calendar_connections'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at BEFORE UPDATE ON google_calendar_connections
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at'
      AND tgrelid = 'public.google_calendar_event_links'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at BEFORE UPDATE ON google_calendar_event_links
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

ALTER TABLE google_calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_calendar_event_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE google_calendar_connections IS
  'One Google Calendar connection per user. refresh_token is AES-256-GCM encrypted. Read and written only by /api/google-calendar/* and /api/cron/google-calendar-sync with the service role, so RLS is on with no policies.';
COMMENT ON TABLE google_calendar_event_links IS
  'Maps each synced appointment or to-do (source_uid, as in the iCalendar feed) to its event in the user''s ConvoReal Google calendar. Service role only.';
