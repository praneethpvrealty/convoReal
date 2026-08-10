-- ============================================================
-- 234_copilot_unmet_requests.sql
--
-- Demand signal from the in-app helper.
--
-- When a user asks the copilot for something ConvoReal cannot do,
-- the model names the missing capability in a short canonical phrase
-- and the app records it here. Aggregated across tenants this is a
-- ranked feature-request backlog nobody had to file:
--
--   SELECT capability_key,
--          min(capability)            AS capability,
--          count(DISTINCT account_id) AS accounts,
--          sum(request_count)         AS asks,
--          max(last_requested_at)     AS last_asked
--   FROM copilot_unmet_requests
--   GROUP BY capability_key
--   ORDER BY accounts DESC, asks DESC;
--
-- One row per (account, capability) so the same phrase asked twice by
-- one account counts as depth (request_count) while a phrase asked by
-- many accounts counts as breadth (distinct account_id). Clustering is
-- done by the model's canonical phrasing, not by embeddings — the
-- helper is instructed to emit lowercase generic phrases, and the raw
-- sample_question is kept for operator review of any bad grouping.
--
-- Written only by the service-role copilot route; read by account
-- admins (their own rows) and by the operator in Studio.
--
-- NOTE: like 109_copilot_qa_cache.sql, apply this in the Supabase SQL
-- Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS copilot_unmet_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Display phrase as the model wrote it, e.g. 'export contacts to excel'.
  capability TEXT NOT NULL,
  -- Normalized dedupe key derived from `capability` (see unmet.ts).
  capability_key TEXT NOT NULL,
  -- First raw question that produced this row, for operator review.
  sample_question TEXT NOT NULL,
  -- Route the user was on when they asked.
  pathname TEXT,
  request_count INT NOT NULL DEFAULT 1,
  last_requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, capability_key)
);

-- Cross-tenant ranking (the operator query above).
CREATE INDEX IF NOT EXISTS idx_copilot_unmet_capability
  ON copilot_unmet_requests (capability_key);
-- Per-account recency, for the account-scoped read policy below.
CREATE INDEX IF NOT EXISTS idx_copilot_unmet_account_recent
  ON copilot_unmet_requests (account_id, last_requested_at DESC);

ALTER TABLE copilot_unmet_requests ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_copilot_unmet_requests_updated_at ON copilot_unmet_requests;
CREATE TRIGGER set_copilot_unmet_requests_updated_at
  BEFORE UPDATE ON copilot_unmet_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Admins see what their own team has been asking for. Writes arrive
-- only through the service-role RPC below (no client INSERT policy).
DROP POLICY IF EXISTS copilot_unmet_requests_select ON copilot_unmet_requests;
CREATE POLICY copilot_unmet_requests_select ON copilot_unmet_requests
  FOR SELECT USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- log_copilot_unmet_request: upsert one (account, capability) row.
-- Repeat asks bump request_count instead of adding rows, so the table
-- grows with distinct unmet capabilities rather than with traffic.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_copilot_unmet_request(
  p_account_id UUID,
  p_capability TEXT,
  p_capability_key TEXT,
  p_question TEXT,
  p_pathname TEXT
) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO copilot_unmet_requests AS u (
    account_id, capability, capability_key, sample_question, pathname
  )
  VALUES (p_account_id, p_capability, p_capability_key, p_question, p_pathname)
  ON CONFLICT (account_id, capability_key) DO UPDATE
    SET request_count     = u.request_count + 1,
        last_requested_at = NOW();
$$;

GRANT EXECUTE ON FUNCTION log_copilot_unmet_request(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ============================================================
-- copilot_qa_cache: two new columns on cached answers.
--
-- unsupported_capability — unsupported answers are still cached (a
-- repeat "can it do X?" costs nothing), but a cache hit must keep
-- counting demand: otherwise only the FIRST person to ask for a
-- feature is ever visible. Storing the capability on the cache row
-- lets the route log the request on the cached path too.
--
-- source_chunks — the knowledge chunks the answer was built from, as
-- [{"id": "...", "v": "..."}]. The app validates them against the
-- live corpus on every hit, so editing one chunk retires exactly the
-- answers that used it. kb_version keeps its role for scaffold
-- changes (rules/tours/contract), which still retire everything.
-- ============================================================

ALTER TABLE copilot_qa_cache
  ADD COLUMN IF NOT EXISTS unsupported_capability TEXT;
ALTER TABLE copilot_qa_cache
  ADD COLUMN IF NOT EXISTS source_chunks JSONB;

-- RETURNS TABLE shape changes, so CREATE OR REPLACE cannot be used.
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
