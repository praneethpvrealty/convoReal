-- ============================================================
-- AI call log — per-call telemetry for every Gemini generation.
--
-- Purpose: (1) real per-feature cost/volume data to drive model
-- tiering and caching decisions; (2) over time, an eval dataset
-- that keeps the door open for fine-tuning / provider swaps.
--
-- Ships INERT: nothing is written until the operator enables it via
--   system_settings key 'ai_call_log' → {"enabled": true}
-- (see src/lib/ai/call-log.ts). Writes are fire-and-forget from the
-- central Gemini client and never block or fail a user request.
--
-- Privacy: prompt/response are stored as short previews (500 chars),
-- not full payloads. Service-role only — RLS enabled with NO
-- policies, same pattern as copilot_qa_cache (migration 109).
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_call_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Caller-declared feature key (matches AI_FEATURE_COSTS where possible,
  -- e.g. 'contact_parse', 'event_parse'). Null for unlabeled call sites.
  feature TEXT,
  -- Model that actually served the call (after failover), e.g. 'gemini-2.5-flash'.
  model TEXT NOT NULL,
  -- Requested tier: 'lite' | 'standard'.
  tier TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  latency_ms INTEGER,
  json_mode BOOLEAN NOT NULL DEFAULT false,
  -- True when the request carried inline media (image/audio).
  has_media BOOLEAN NOT NULL DEFAULT false,
  -- Token usage as reported by the API (usageMetadata); null if absent.
  prompt_tokens INTEGER,
  response_tokens INTEGER,
  -- Character sizes of the text portions (media excluded).
  prompt_chars INTEGER,
  response_chars INTEGER,
  -- First 80 chars of the system instruction — groups unlabeled calls by
  -- feature without touching every call site.
  system_preview TEXT,
  -- Truncated input/output previews for eval-set building (500 chars).
  input_preview TEXT,
  output_preview TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_call_log_created ON ai_call_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_call_log_feature ON ai_call_log (feature, created_at DESC);

-- Service-role only: RLS on, zero policies (same as copilot_qa_cache).
ALTER TABLE ai_call_log ENABLE ROW LEVEL SECURITY;
