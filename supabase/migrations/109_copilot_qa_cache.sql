-- ============================================================
-- Copilot self-learning Q&A cache.
--
-- Stores validated helper answers keyed by a semantic embedding of
-- the question, so a similar question from ANY user is answered from
-- this table instead of a fresh Gemini call. The table is global
-- (cross-tenant) by design: only generic app questions ever enter it
-- (the app gates out first-person/PII/context-dependent questions
-- before storing), so no account data lives here. Access is
-- service-role only — RLS is enabled with NO policies, and the RPCs
-- are granted to service_role exclusively.
--
-- Staleness is handled by kb_version: the app stamps every row with
-- a hash of its knowledge base + tour registry, and match_copilot_qa
-- only returns rows from the current version — change the in-app
-- help content and old answers silently stop matching.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS copilot_qa_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Original question, for operator review in Studio.
  question TEXT NOT NULL,
  -- gemini-embedding-001 @ outputDimensionality 768.
  embedding vector(768) NOT NULL,
  reply TEXT NOT NULL,
  tour_id TEXT,
  navigate_to TEXT,
  -- Hash of knowledge base + tours at write time (see qa-cache.ts).
  kb_version TEXT NOT NULL,
  hit_count INT NOT NULL DEFAULT 0,
  up_votes INT NOT NULL DEFAULT 0,
  down_votes INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW over ivfflat: no training-size threshold, fine for a table
-- that grows by unique-questions only (rate-limit bounded).
CREATE INDEX IF NOT EXISTS copilot_qa_cache_embedding_idx
  ON copilot_qa_cache USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS copilot_qa_cache_kb_version_idx
  ON copilot_qa_cache (kb_version);

-- Service-role only: RLS on, zero policies. authenticated/anon get
-- nothing; the service key bypasses RLS.
ALTER TABLE copilot_qa_cache ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- match_copilot_qa: best cached answers for a question embedding.
-- Deterministic validation lives here (version, age, community
-- votes); the similarity threshold arrives from the app so it can
-- be tuned without a migration.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_copilot_qa(
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
  similarity FLOAT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    c.id,
    c.question,
    c.reply,
    c.tour_id,
    c.navigate_to,
    1 - (c.embedding <=> p_embedding) AS similarity
  FROM copilot_qa_cache c
  WHERE c.kb_version = p_kb_version
    AND c.created_at > now() - INTERVAL '90 days'
    -- Community demotion: 2+ downvotes outnumbering upvotes retires
    -- the entry from serving (row stays for operator review).
    AND NOT (c.down_votes >= 2 AND c.down_votes > c.up_votes)
    AND 1 - (c.embedding <=> p_embedding) >= p_threshold
  ORDER BY c.embedding <=> p_embedding
  LIMIT p_count;
$$;

GRANT EXECUTE ON FUNCTION match_copilot_qa(vector(768), TEXT, FLOAT, INT) TO service_role;

-- ------------------------------------------------------------
-- bump_copilot_qa_hit: usage accounting on a served cache hit.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION bump_copilot_qa_hit(p_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE copilot_qa_cache
  SET hit_count = hit_count + 1,
      last_used_at = now()
  WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION bump_copilot_qa_hit(UUID) TO service_role;

-- ------------------------------------------------------------
-- vote_copilot_qa: atomic 👍/👎 from users. Enough 👎 and the entry
-- stops being served (see the filter in match_copilot_qa).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION vote_copilot_qa(p_id UUID, p_up BOOLEAN)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE copilot_qa_cache
  SET up_votes   = up_votes   + (CASE WHEN p_up THEN 1 ELSE 0 END),
      down_votes = down_votes + (CASE WHEN p_up THEN 0 ELSE 1 END)
  WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION vote_copilot_qa(UUID, BOOLEAN) TO service_role;
