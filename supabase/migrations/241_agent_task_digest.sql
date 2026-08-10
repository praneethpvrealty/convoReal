-- ============================================================
-- Agent task digest: an agent's own open work, pushed to them a few
-- times a day instead of waiting to be looked up.
--
-- Settings are PER AGENT, not per account. The times someone wants
-- their day read back to them are personal — a site agent wants 7am
-- before leaving, a closer wants 9pm to see what slipped — and one
-- account-wide row cannot hold both.
--
-- Send times are stored as "HH:MM" strings in IST rather than as
-- timestamps. The digest recurs daily forever; what is being stored is
-- a time of day, not an instant, and the engine is India-only (see
-- istDayWindow, nowInIst). A DATE-less TIME[] would work too, but the
-- text form is what the settings UI round-trips and what the cron
-- compares against, so storing it any other way just adds two
-- conversions.
--
-- Frequency is not a separate column: it is how many times are in the
-- array. An agent who wants it twice removes one, and one who wants it
-- hourly can say so without the schema learning a new word.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_task_digest_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  /** IST "HH:MM", ascending. Defaults are the three the brokerage
   *  asked for: before the day starts, mid-day, and after it ends. */
  send_times TEXT[] NOT NULL DEFAULT ARRAY['07:00', '13:00', '21:00'],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_task_digest_settings_account
  ON agent_task_digest_settings (account_id) WHERE enabled;

ALTER TABLE agent_task_digest_settings ENABLE ROW LEVEL SECURITY;

-- An agent's own row only. These are personal preferences, and there is
-- no screen that reads another member's — an admin changing them would
-- be changing when somebody else's phone buzzes at 7am.
DROP POLICY IF EXISTS agent_task_digest_settings_own ON agent_task_digest_settings;
CREATE POLICY agent_task_digest_settings_own ON agent_task_digest_settings
  FOR ALL USING (
    user_id = auth.uid() AND is_account_member(account_id)
  ) WITH CHECK (
    user_id = auth.uid() AND is_account_member(account_id)
  );

DROP TRIGGER IF EXISTS set_agent_task_digest_settings_updated_at ON agent_task_digest_settings;
CREATE TRIGGER set_agent_task_digest_settings_updated_at
  BEFORE UPDATE ON agent_task_digest_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── The claim ledger ─────────────────────────────────────────
--
-- One row per agent per slot per IST day, inserted BEFORE the send.
-- The unique constraint is what makes the cron safe to run every half
-- hour and safe to re-run after a failure: a second attempt at the same
-- slot loses the insert with 23505 and sends nothing. It is also what
-- lets a missed run catch up — the cron asks "which slots have passed
-- today that I have no row for", so a slot skipped at 07:00 because the
-- platform was down still goes out at 07:30 rather than being lost.

CREATE TABLE IF NOT EXISTS agent_task_digest_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  digest_date DATE NOT NULL,
  /** The configured "HH:MM" this send belongs to. */
  slot TEXT NOT NULL,
  task_count INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, user_id, digest_date, slot)
);

CREATE INDEX IF NOT EXISTS idx_agent_task_digest_log_lookup
  ON agent_task_digest_log (account_id, user_id, digest_date);

ALTER TABLE agent_task_digest_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_task_digest_log_select ON agent_task_digest_log;
CREATE POLICY agent_task_digest_log_select ON agent_task_digest_log
  FOR SELECT USING (is_account_member(account_id));

COMMENT ON TABLE agent_task_digest_settings IS
  'Per-agent schedule for the task digest. send_times are IST "HH:MM"; the count of them IS the frequency.';
COMMENT ON TABLE agent_task_digest_log IS
  'Insert-as-claim ledger. The unique constraint makes the digest cron idempotent and lets a missed slot catch up.';
