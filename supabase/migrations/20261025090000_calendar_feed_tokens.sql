CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS calendar_feed_tokens_user_key
  ON calendar_feed_tokens (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS calendar_feed_tokens_hash_key
  ON calendar_feed_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_calendar_feed_tokens_account
  ON calendar_feed_tokens (account_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at'
      AND tgrelid = 'public.calendar_feed_tokens'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at BEFORE UPDATE ON calendar_feed_tokens
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

ALTER TABLE calendar_feed_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'calendar_feed_tokens'
      AND policyname = 'Members read their own calendar feed'
  ) THEN
    CREATE POLICY "Members read their own calendar feed" ON calendar_feed_tokens
      FOR SELECT USING (
        user_id = auth.uid() AND is_account_member(account_id, 'viewer')
      );
  END IF;
END $$;

COMMENT ON TABLE calendar_feed_tokens IS
  'One secret iCalendar subscription link per user. Only the SHA-256 digest of the token is stored; the link is shown once when created or reset. Written only by /api/calendar/feed with the service role; read by /api/public/calendar-feed/[token].';
