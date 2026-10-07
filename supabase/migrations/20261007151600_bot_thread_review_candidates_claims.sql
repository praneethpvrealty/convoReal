-- A conversation's last review boundary is its newest finalised review
-- (judged_at set) or a claim made in the last 15 minutes, which a live
-- run holds while it judges. A claim older than that with no judged_at
-- was left by a run that died, so the conversation is due again and the
-- run takes the stale row over. Kept in step with CLAIM_STALE_MS in
-- src/lib/whatsapp/inbound/transcripts/thread-review.ts. Oldest due
-- first: what one night's budget leaves over is reviewed ahead of the
-- next day's traffic, so a thread waits its turn and is never pushed
-- behind newer activity until it ages out.

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
      WHERE r.conversation_id = a.conversation_id
        AND (r.judged_at IS NOT NULL
          OR r.reviewed_at > now() - interval '15 minutes')),
    '-infinity'::timestamptz
  )
  ORDER BY a.latest_bot_at ASC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.bot_thread_review_candidates(TIMESTAMPTZ, INT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_thread_review_candidates(TIMESTAMPTZ, INT, UUID[]) TO service_role;
