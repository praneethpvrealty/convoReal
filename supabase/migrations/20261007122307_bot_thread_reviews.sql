-- Nightly bot thread review: one row per conversation per IST day in
-- which the bot wrote, holding the thread as the lead read it, the
-- transcript-rule violations (src/lib/whatsapp/inbound/transcripts/
-- transcript-rules.ts), the model's score and issues, and the verdict.
-- Written by the service role from /api/cron/bot-thread-review, read on
-- Admin → Bot replies, and by an account's own admins for their threads.

CREATE TABLE IF NOT EXISTS bot_thread_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  review_day DATE NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  transcript JSONB NOT NULL,
  rule_violations JSONB NOT NULL DEFAULT '[]'::jsonb,
  score INTEGER,
  verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'fail', 'unscored')),
  issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  model TEXT,
  admin_verdict TEXT CHECK (admin_verdict IN ('good', 'bad')),
  admin_note TEXT,
  admin_reviewed_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (conversation_id, review_day)
);

CREATE INDEX IF NOT EXISTS bot_thread_reviews_verdict_idx
  ON bot_thread_reviews (verdict, reviewed_at DESC);

CREATE INDEX IF NOT EXISTS bot_thread_reviews_account_idx
  ON bot_thread_reviews (account_id, reviewed_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at'
      AND tgrelid = 'public.bot_thread_reviews'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at
      BEFORE UPDATE ON bot_thread_reviews
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END
$$;

ALTER TABLE bot_thread_reviews ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'bot_thread_reviews'
      AND policyname = 'bot_thread_reviews_select'
  ) THEN
    CREATE POLICY bot_thread_reviews_select ON bot_thread_reviews
      FOR SELECT USING (is_account_member(account_id, 'admin'));
  END IF;
END
$$;
