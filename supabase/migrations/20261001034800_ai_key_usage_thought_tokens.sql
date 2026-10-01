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
    (COALESCE(SUM(response_tokens), 0) + COALESCE(SUM(thought_tokens), 0))::bigint AS response_tokens
  FROM ai_call_log
  WHERE created_at >= NOW() - make_interval(days => LEAST(GREATEST(p_days, 1), 90))
  GROUP BY 1, 2, 3, 4
$$;

REVOKE ALL ON FUNCTION ai_key_daily_usage(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ai_key_daily_usage(INTEGER) TO service_role;
