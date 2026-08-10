-- ============================================================
-- 239_broadcast_reclaim_guard.sql
--
-- Stops the reclaim path from re-sending a message that already went
-- out, and stops a live-but-slow dispatcher having its rows stolen.
--
-- Batch 5 went out with 8 of 50 leads double-messaged. The row-level
-- claim (231) worked exactly as designed — the two sends were not
-- concurrent. The sequence was:
--
--   05:38:11  a dispatcher claims all 50 rows (status 'sending')
--   05:38-05:55  it sends; 34 rows complete and flip to 'sent'
--   ~05:48    the 600s stale window expires on everything still 'sending'
--   05:55:41  the sweep finds 16 rows still 'sending', correctly
--             concludes the dispatcher died, reclaims and sends them
--
-- 8 of those 16 had already been dispatched: Meta had accepted the
-- message and the row in `messages` was written, but the process was
-- reclaimed before it could flip broadcast_recipients to 'sent'. The
-- claim had no way to tell "never sent" from "sent, not yet recorded",
-- so it resent.
--
-- Two changes:
--
-- 1. The stale-reclaim branch now refuses any row that already has a
--    message on record for this broadcast's template. `messages` is
--    written by the dispatcher itself immediately after Meta accepts,
--    so it is the earliest durable evidence a send happened — earlier
--    than the status flip that the crash lost. NOT EXISTS keeps the
--    check inside the function rather than shipping ids through a URL
--    filter.
--
-- 2. renew_broadcast_recipient_claims lets a dispatcher push its own
--    rows' claimed_at forward while it works, so a healthy run that is
--    merely slow (rate limiting) is never mistaken for a dead one.
--    The broadcast-level lease was already renewed per batch; the row
--    claims were not, which is the other half of this failure.
--
-- Sending late is recoverable. Sending twice is not.
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_broadcast_recipients(
  p_broadcast_id UUID,
  p_limit INT DEFAULT 200,
  p_stale_seconds INT DEFAULT 600
)
RETURNS SETOF broadcast_recipients
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE broadcast_recipients br
     SET status = 'sending',
         claimed_at = NOW()
   WHERE br.id IN (
     SELECT r.id
       FROM broadcast_recipients r
       JOIN broadcasts b ON b.id = r.broadcast_id
      WHERE r.broadcast_id = p_broadcast_id
        AND (
          r.status IN ('pending', 'rate_limited')
          -- A previous sender took this row and never came back. Only
          -- safe to resend if nothing was dispatched for it: a message
          -- already on record means Meta accepted one, whether or not
          -- this row ever got flipped to 'sent'.
          OR (r.status = 'sending'
              AND (r.claimed_at IS NULL
                   OR r.claimed_at < NOW() - make_interval(secs => p_stale_seconds))
              AND r.whatsapp_message_id IS NULL
              AND NOT EXISTS (
                SELECT 1
                  FROM messages m
                  JOIN conversations cv ON cv.id = m.conversation_id
                 WHERE cv.contact_id = r.contact_id
                   AND m.account_id = b.account_id
                   AND m.template_name = b.template_name
                   AND m.created_at >= b.created_at
              ))
        )
        AND (r.retry_after IS NULL OR r.retry_after <= NOW())
      ORDER BY r.created_at
      LIMIT p_limit
      -- Two senders arriving together do not queue behind each other
      -- for rows the other already took; the loser simply gets fewer.
      FOR UPDATE OF r SKIP LOCKED
   )
  RETURNING br.*;
$$;

COMMENT ON FUNCTION public.claim_broadcast_recipients(UUID, INT, INT) IS
  'Atomically claims due recipients of a broadcast, returning only rows this caller moved to sending. Never reclaims a row that already has a message on record for this broadcast, so a dispatcher killed between the send and the status write cannot cause a resend.';

REVOKE ALL ON FUNCTION public.claim_broadcast_recipients(UUID, INT, INT) FROM PUBLIC, anon;

-- Pushes a live dispatcher's own claims forward. Scoped to the ids the
-- caller actually claimed, so it can never extend another dispatcher's
-- rows, and to 'sending', so it cannot resurrect a finished one.
CREATE OR REPLACE FUNCTION public.renew_broadcast_recipient_claims(
  p_ids UUID[]
)
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH renewed AS (
    UPDATE broadcast_recipients
       SET claimed_at = NOW()
     WHERE id = ANY(p_ids)
       AND status = 'sending'
    RETURNING 1
  )
  SELECT COUNT(*)::INT FROM renewed;
$$;

COMMENT ON FUNCTION public.renew_broadcast_recipient_claims(UUID[]) IS
  'Refreshes claimed_at on rows this dispatcher still holds, so a slow but healthy run is not treated as abandoned and taken over.';

REVOKE ALL ON FUNCTION public.renew_broadcast_recipient_claims(UUID[]) FROM PUBLIC, anon;
