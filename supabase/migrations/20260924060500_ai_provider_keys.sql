CREATE TABLE IF NOT EXISTS ai_provider_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'gemini',
  label TEXT NOT NULL,
  key_ciphertext TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'general' CHECK (scope IN ('general', 'import')),
  priority INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  resting_until TIMESTAMPTZ,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (provider, label)
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON ai_provider_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE ai_provider_keys ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS ai_key_topups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id UUID NOT NULL REFERENCES ai_provider_keys(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'INR')),
  topped_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_key_topups_key_idx
  ON ai_key_topups (key_id, topped_up_at DESC);

ALTER TABLE ai_key_topups ENABLE ROW LEVEL SECURITY;

ALTER TABLE ai_call_log ADD COLUMN IF NOT EXISTS key_label TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_call_log_key_label
  ON ai_call_log (key_label, created_at DESC);

CREATE OR REPLACE FUNCTION ai_key_daily_usage(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
  day DATE,
  key_label TEXT,
  model TEXT,
  feature TEXT,
  calls BIGINT,
  failures BIGINT,
  prompt_tokens BIGINT,
  response_tokens BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
    COALESCE(key_label, 'unlabelled') AS key_label,
    model,
    COALESCE(feature, 'other') AS feature,
    COUNT(*) AS calls,
    COUNT(*) FILTER (WHERE NOT success) AS failures,
    COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
    COALESCE(SUM(response_tokens), 0)::bigint AS response_tokens
  FROM ai_call_log
  WHERE created_at >= NOW() - make_interval(days => LEAST(GREATEST(p_days, 1), 90))
  GROUP BY 1, 2, 3, 4
$$;

REVOKE ALL ON FUNCTION ai_key_daily_usage(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ai_key_daily_usage(INTEGER) TO service_role;
