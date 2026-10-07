-- Which conversations the nightly bot thread review is due on: every
-- conversation with a bot message (not a private staff note, not a
-- delivery Meta reported as failed) since p_since whose newest such
-- message is later than its last review's window_end. Aggregated here
-- rather than by paging messages into the app, so the scan has no
-- ceiling to age threads out behind. p_exclude carries the conversations
-- one run has already given up on. Service role only: the cron calls it.

CREATE OR REPLACE FUNCTION public.bot_thread_review_candidates(
  p_since TIMESTAMPTZ,
  p_limit INT,
  p_exclude UUID[] DEFAULT '{}'
)
RETURNS TABLE (
  conversation_id UUID,
  account_id UUID,
  latest_bot_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH activity AS (
    SELECT m.conversation_id, max(m.created_at) AS latest_bot_at
    FROM messages m
    WHERE m.sender_type = 'bot'
      AND m.private = false
      AND m.status IS DISTINCT FROM 'failed'
      AND m.created_at >= p_since
      AND NOT (m.conversation_id = ANY (p_exclude))
    GROUP BY m.conversation_id
  )
  SELECT a.conversation_id, c.account_id, a.latest_bot_at
  FROM activity a
  JOIN conversations c ON c.id = a.conversation_id
  WHERE a.latest_bot_at > COALESCE(
    (SELECT max(r.window_end) FROM bot_thread_reviews r
      WHERE r.conversation_id = a.conversation_id),
    '-infinity'::timestamptz
  )
  ORDER BY a.latest_bot_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.bot_thread_review_candidates(TIMESTAMPTZ, INT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_thread_review_candidates(TIMESTAMPTZ, INT, UUID[]) TO service_role;
