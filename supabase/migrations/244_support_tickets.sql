-- ============================================================
-- 244_support_tickets.sql — helper chat escalation to the help desk.
--
-- When the copilot cannot answer (or only partly can), the user files
-- a ticket from the chat itself. The support team triages it from
-- Admin → Support, assigns it, and answers back over the channel the
-- user picked — WhatsApp (platform sender) or email (Resend). The
-- reference (HELP-XXXX) is what the user quotes later, exactly like
-- BUG-XXXX for bug reports.
--
-- Ordinary operational table: account_id NOT NULL, RLS on,
-- updated_at trigger, policies through is_account_member(). Platform
-- staff read across tenants through the service-role admin route,
-- not through a policy.
--
-- Also: copilot_qa_cache learns a `coverage` column so a cached
-- mobile answer keeps its verdict (full / web_only / partial / none)
-- and the app can re-attach the right affordance on a cache hit.
-- Like 109/236, apply in the Supabase SQL Editor.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'support_ticket_status') THEN
    CREATE TYPE support_ticket_status AS ENUM ('open', 'assigned', 'answered', 'closed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Short human reference shown back to the requester ("HELP-4F2A").
  reference TEXT NOT NULL UNIQUE,

  question TEXT NOT NULL,
  -- What the copilot answered before the escalation, for triage context.
  helper_reply TEXT,
  -- The helper's coverage verdict at filing time (mobile asks only).
  coverage TEXT,
  platform TEXT NOT NULL DEFAULT 'web',
  pathname TEXT,

  -- How the user wants the answer back.
  preferred_channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (preferred_channel IN ('whatsapp', 'email')),
  contact_phone TEXT,
  contact_email TEXT,

  status support_ticket_status NOT NULL DEFAULT 'open',
  assigned_to_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,

  answer TEXT,
  answered_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  answered_at TIMESTAMPTZ,
  -- Which deliveries actually went out, e.g. {whatsapp,email}.
  answer_sent_via TEXT[] NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_account_time
  ON support_tickets (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_triage
  ON support_tickets (status, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON support_tickets;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Any member can see their account's tickets and file one. There is
-- no tenant UPDATE policy: triage, assignment and answers come only
-- from the service-role admin route.
DROP POLICY IF EXISTS support_tickets_select ON support_tickets;
CREATE POLICY support_tickets_select ON support_tickets FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS support_tickets_insert ON support_tickets;
CREATE POLICY support_tickets_insert ON support_tickets FOR INSERT WITH CHECK (
  is_account_member(account_id, 'viewer')
);

COMMENT ON TABLE support_tickets IS
  'Help-desk escalations filed from the in-app helper chat. Answered by platform staff from Admin → Support; the reply is delivered over the requester''s chosen channel (WhatsApp via the platform sender, or email).';

-- ------------------------------------------------------------
-- copilot_qa_cache.coverage — the mobile coverage verdict cached
-- with the answer. RETURNS TABLE shape changes, so the matcher is
-- dropped and recreated (same pattern as 236).
-- ------------------------------------------------------------

ALTER TABLE copilot_qa_cache
  ADD COLUMN IF NOT EXISTS coverage TEXT;

DROP FUNCTION IF EXISTS match_copilot_qa(vector(768), TEXT, FLOAT, INT);

CREATE FUNCTION match_copilot_qa(
  p_embedding vector(768),
  p_kb_version TEXT,
  p_threshold FLOAT DEFAULT 0.90,
  p_count INT DEFAULT 3
) RETURNS TABLE(
  id UUID,
  question TEXT,
  reply TEXT,
  tour_id TEXT,
  navigate_to TEXT,
  unsupported_capability TEXT,
  source_chunks JSONB,
  coverage TEXT,
  similarity FLOAT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    c.id,
    c.question,
    c.reply,
    c.tour_id,
    c.navigate_to,
    c.unsupported_capability,
    c.source_chunks,
    c.coverage,
    1 - (c.embedding <=> p_embedding) AS similarity
  FROM copilot_qa_cache c
  WHERE c.kb_version = p_kb_version
    AND c.created_at > now() - INTERVAL '90 days'
    AND NOT (c.down_votes >= 2 AND c.down_votes > c.up_votes)
    AND 1 - (c.embedding <=> p_embedding) >= p_threshold
  ORDER BY c.embedding <=> p_embedding
  LIMIT p_count;
$$;

GRANT EXECUTE ON FUNCTION match_copilot_qa(vector(768), TEXT, FLOAT, INT) TO service_role;
