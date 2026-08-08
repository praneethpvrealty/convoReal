-- ============================================================
-- 226_conversation_reply_state.sql
-- Give the inbox a real answer to "who is waiting on me?".
--
-- conversations.status (open/pending/closed) is a manual queue
-- state: nothing marks a thread when a customer's message goes
-- unanswered, so every filter chip built on it shows the same
-- undifferentiated "open" pile. The genuine unanswered-thread
-- computation lived only in the Today screen, which re-walks the
-- last 24h of messages on every load.
--
-- Persist it instead: `awaiting_reply` flips true on every inbound
-- customer message (webhook-handler + public intake routes) and
-- false on any outbound send (meta-api-dispatcher and the direct
-- bot-send sites), and `last_customer_message_at` stamps when the
-- customer last wrote — which is also the anchor of Meta's 24-hour
-- free-form reply window.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS awaiting_reply BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMPTZ;

UPDATE conversations c
SET last_customer_message_at = lc.at
FROM (
  SELECT conversation_id, MAX(created_at) AS at
  FROM messages
  WHERE sender_type = 'customer'
  GROUP BY conversation_id
) lc
WHERE lc.conversation_id = c.id
  AND c.last_customer_message_at IS NULL;

-- Backfill the flag only for the last 7 days: a thread nobody answered
-- for a month is stale outreach, not a reply queue, and seeding it in
-- would bury the leads who wrote this week.
UPDATE conversations c
SET awaiting_reply = true
WHERE c.last_customer_message_at >= NOW() - INTERVAL '7 days'
  AND c.status <> 'closed'
  AND NOT c.is_archived
  AND NOT EXISTS (
    SELECT 1 FROM messages m
    WHERE m.conversation_id = c.id
      AND m.sender_type <> 'customer'
      AND m.created_at > c.last_customer_message_at
  );

-- ============================================================
-- Most-active conversations, aggregated in SQL (same shape as the
-- migration 168-170 RPCs). One scan over the account's recent
-- messages instead of shipping rows to the client to count. The
-- membership guard sits in the WHERE clause: a non-member gets no
-- rows, never another account's traffic.
-- ============================================================

CREATE OR REPLACE FUNCTION public.conversation_activity(
  p_account_id UUID,
  p_hours INTEGER DEFAULT 24
)
RETURNS TABLE (
  conversation_id UUID,
  message_count BIGINT,
  inbound_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.conversation_id,
    count(*),
    count(*) FILTER (WHERE m.sender_type = 'customer')
  FROM messages m
  WHERE m.account_id = p_account_id
    AND is_account_member(p_account_id)
    AND m.created_at >= NOW() - make_interval(hours => GREATEST(p_hours, 1))
  GROUP BY m.conversation_id
  ORDER BY count(*) DESC
  LIMIT 100;
$$;

COMMENT ON FUNCTION public.conversation_activity(UUID, INTEGER) IS
  'Per-conversation message counts over the last p_hours for one account, busiest first. Powers the inbox "Active" filter.';

REVOKE ALL ON FUNCTION public.conversation_activity(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.conversation_activity(UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.conversation_activity(UUID, INTEGER) TO authenticated;
