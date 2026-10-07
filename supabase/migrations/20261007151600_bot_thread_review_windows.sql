-- Which conversations the nightly bot thread review is due on, and
-- where each one's next window starts. Succeeds bot_thread_review_candidates
-- (20261007145237), which returned a different row shape; a function's
-- return type cannot be replaced in place and a DROP never reaches
-- production through the connector, so the earlier function stays as
-- it is, unused.
--
-- A conversation's last review boundary is the window_end of its
-- newest finalised review (judged_at set) or of a claim made in the
-- last 15 minutes, which a live run holds while it judges. A claim
-- older than that with no judged_at was left by a run that died, so it
-- does not count and the run takes the stale row over. Kept in step
-- with CLAIM_STALE_MS in src/lib/whatsapp/inbound/transcripts/
-- thread-review.ts.
--
-- The next window starts at that boundary (from_at) and is read from
-- the first bot message after it (first_bot_at); the review's own
-- window_end is the newest bot message it actually read, so windows
-- are contiguous and nothing a cap left out is ever counted as covered.
-- Oldest due first: what one night's budget leaves over is reviewed
-- ahead of the next day's traffic. The scan starts at the earliest
-- review on record, so once the review is live nothing after that
-- night ages out; p_since is the floor for the very first run.

CREATE OR REPLACE FUNCTION public.bot_thread_review_windows(
  p_since TIMESTAMPTZ,
  p_limit INT,
  p_exclude UUID[] DEFAULT '{}'
)
RETURNS TABLE (
  conversation_id UUID,
  account_id UUID,
  from_at TIMESTAMPTZ,
  first_bot_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH floor AS (
    SELECT least(
      p_since,
      COALESCE((SELECT min(r.window_start) FROM bot_thread_reviews r), p_since)
    ) AS since
  ),
  reviewed AS (
    SELECT r.conversation_id, max(r.window_end) AS up_to
    FROM bot_thread_reviews r
    WHERE r.judged_at IS NOT NULL
      OR r.reviewed_at > now() - interval '15 minutes'
    GROUP BY r.conversation_id
  ),
  activity AS (
    SELECT m.conversation_id,
      COALESCE(r.up_to, floor.since) AS from_at,
      min(m.created_at) AS first_bot_at
    FROM messages m
    CROSS JOIN floor
    LEFT JOIN reviewed r ON r.conversation_id = m.conversation_id
    WHERE m.sender_type = 'bot'
      AND m.private = false
      AND m.status IS DISTINCT FROM 'failed'
      AND m.created_at >= floor.since
      AND m.created_at > COALESCE(r.up_to, '-infinity'::timestamptz)
      AND NOT (m.conversation_id = ANY (p_exclude))
    GROUP BY m.conversation_id, r.up_to, floor.since
  )
  SELECT a.conversation_id, c.account_id, a.from_at, a.first_bot_at
  FROM activity a
  JOIN conversations c ON c.id = a.conversation_id
  ORDER BY a.first_bot_at ASC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.bot_thread_review_windows(TIMESTAMPTZ, INT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_thread_review_windows(TIMESTAMPTZ, INT, UUID[]) TO service_role;
