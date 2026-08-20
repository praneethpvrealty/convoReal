-- ============================================================
-- 20260820060000_conversation_sweep.sql
--
-- The daily read-back over yesterday's conversations.
--
-- Everything the Engine learns today it learns in the moment: an
-- inbound message updates preferences, an outbound price sentence
-- proposes a listing fact. Both run behind a single message and are
-- deliberately narrow, because they run on EVERY message and the
-- common case has to cost nothing. That narrowness is the point and
-- also the hole — the regex that keeps `chat-learning` cheap is the
-- same regex that missed "we can close this at 13cr", and nothing
-- ever goes back to look.
--
-- This is the going-back-to-look. Once a day, over a bounded window,
-- reading a whole thread instead of one bubble. Two things fall out
-- of that reading, and they are different in kind:
--
--   1. FACTS about a contact or a listing. These already have a home
--      and a policy — `learned_facts` and src/lib/learning/fields.ts
--      decide apply-vs-propose per field, and the sweep is just
--      another caller. It gets a new `source` value and nothing else.
--
--   2. GAPS. "Nobody answered this question", "the floor plan was
--      promised and never sent", "this buyer has been talking for a
--      week and has no deal". These are not facts about a record and
--      have nowhere to be written. That is what this table is.
--
-- A gap is an OBSERVATION, never a write. The sweep resolves nothing
-- and messages no client on its own — the most it does is put the
-- observation where a human sees it at 6am. The reason is the same
-- one behind the suggestion queue in 217: a model that mis-reads
-- "I'll call you tomorrow" as an unkept promise costs a second of
-- someone's attention, whereas a model that acted on it would have
-- chased a client who was never waiting.
-- ============================================================

-- ── The sweep as a fact learner ──────────────────────────────
-- learned_facts already carries the four in-the-moment sources. The
-- sweep is the fifth, and it is worth being able to tell apart: a
-- fact read out of a whole thread the next morning deserves more
-- scepticism from a reviewer than one read out of the sentence that
-- had just been typed.
ALTER TABLE learned_facts DROP CONSTRAINT IF EXISTS learned_facts_source_check;
ALTER TABLE learned_facts ADD CONSTRAINT learned_facts_source_check
  CHECK (source IN ('agent_reply', 'lead_message', 'owner_reply', 'portal_sync', 'daily_sweep'));

-- ── Gaps ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Who and what it is about. All nullable and all ON DELETE SET NULL:
  -- a gap outlives the record that prompted it, because "we never
  -- answered this person" stays true after someone deletes the
  -- contact, and the evidence text still reads without the join.
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  -- The agent the thread belongs to, when one is assigned. Drives who
  -- the 6am digest names, not who may see the row.
  assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Which channel the thread was read from. The account holder's own
  -- WhatsApp reaches us as journey_events, not messages, and it is
  -- outbound-only — an unanswered_question can never be raised
  -- against it, so a reader needs to know which half it came from.
  channel TEXT NOT NULL DEFAULT 'client'
    CHECK (channel IN ('client', 'personal_whatsapp')),

  kind TEXT NOT NULL CHECK (kind IN (
    -- A client asked something and the window closed with no answer.
    'unanswered_question',
    -- "I'll send the floor plan" / "I'll call you tomorrow", with no
    -- message, task or appointment behind it.
    'unkept_promise',
    -- A live conversation that ended without anything scheduled.
    'missing_next_step',
    -- Someone is being worked and has no deal on any pipeline.
    'no_deal',
    -- The bot answered badly, or an agent had to step in over it.
    'bot_handoff',
    -- A named requirement nobody has matched inventory against.
    'unmatched_requirement'
  )),

  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('high', 'medium', 'low')),

  -- One line, written for the digest. The reviewer reads this first.
  summary TEXT NOT NULL,
  -- What was actually said. A gap is approved or dismissed on the
  -- quote, not on the model's reading of it — same rule as 217.
  evidence TEXT NOT NULL,
  -- What the sweep thinks should happen. Advisory text; nothing in
  -- this schema executes it.
  suggested_action TEXT,

  -- When the conversation moment happened, not when we noticed it.
  -- The digest sorts on this so yesterday reads in order.
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,

  -- Stable identity for "this same gap". The sweep reruns over
  -- overlapping windows and a thread nobody has dealt with yet is
  -- still the same unanswered question tomorrow — re-raising it as a
  -- second row would turn a quiet queue into a growing one and train
  -- everyone to ignore it. Built in src/lib/sweep/gaps.ts from the
  -- kind plus the thing it is about, never from the model's wording.
  dedupe_key TEXT NOT NULL,

  -- How many mornings this has survived. Drives escalation in the
  -- digest: a question unanswered for four days is not the same news
  -- as one unanswered since last night.
  occurrence_count INTEGER NOT NULL DEFAULT 1,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One OPEN gap per dedupe key per account. Resolved and dismissed
-- rows are left alone: they are the record of what was decided, and
-- excluding them here is what lets a genuinely recurring problem be
-- raised again after someone closed the last one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_gaps_open_key
  ON conversation_gaps (account_id, dedupe_key)
  WHERE status = 'open';

-- The review screen and the digest: an account's open gaps, worst and
-- newest first.
CREATE INDEX IF NOT EXISTS idx_conversation_gaps_account_open
  ON conversation_gaps (account_id, severity, occurred_at DESC)
  WHERE status = 'open';

-- "What is outstanding on this contact?" — read from the contact page.
CREATE INDEX IF NOT EXISTS idx_conversation_gaps_contact
  ON conversation_gaps (contact_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON conversation_gaps;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON conversation_gaps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE conversation_gaps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_gaps_select ON conversation_gaps;
CREATE POLICY conversation_gaps_select ON conversation_gaps FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS conversation_gaps_insert ON conversation_gaps;
CREATE POLICY conversation_gaps_insert ON conversation_gaps FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent')
);

-- Resolving and dismissing are updates; rows are never deleted, so
-- what was raised and what was done about it stays auditable.
DROP POLICY IF EXISTS conversation_gaps_update ON conversation_gaps;
CREATE POLICY conversation_gaps_update ON conversation_gaps FOR UPDATE USING (
  is_account_member(account_id, 'agent')
);

-- ── The run ledger ───────────────────────────────────────────
-- Insert-as-claim, exactly like agent_task_digest_log: the unique
-- index on (account_id, run_date) is what makes a rerun a no-op. The
-- sweep costs a model call per thread, so a cron that fires twice —
-- a platform retry, a manual poke — must not pay twice.
CREATE TABLE IF NOT EXISTS conversation_sweep_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The IST day being analysed, not the day we ran. A sweep that
  -- slips past midnight still belongs to the window it read.
  run_date DATE NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,

  threads_seen INTEGER NOT NULL DEFAULT 0,
  threads_analyzed INTEGER NOT NULL DEFAULT 0,
  facts_applied INTEGER NOT NULL DEFAULT 0,
  facts_proposed INTEGER NOT NULL DEFAULT 0,
  gaps_opened INTEGER NOT NULL DEFAULT 0,
  credits_burned INTEGER NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  -- Why a run did nothing. 'skipped' with a reason is a normal
  -- outcome — no credits, feature off, nothing to read — and reads
  -- very differently from a failure when someone asks why there was
  -- no digest.
  detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_sweep_runs_claim
  ON conversation_sweep_runs (account_id, run_date);

DROP TRIGGER IF EXISTS set_updated_at ON conversation_sweep_runs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON conversation_sweep_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE conversation_sweep_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_sweep_runs_select ON conversation_sweep_runs;
CREATE POLICY conversation_sweep_runs_select ON conversation_sweep_runs FOR SELECT USING (
  is_account_member(account_id)
);
