-- 20261004072000_today_insights_rpc.sql
-- One round trip for the Today insights bar on web and mobile.
--
-- SECURITY INVOKER on purpose: the queries it replaces ran under RLS,
-- which limits agents and leaders to the conversations assigned to them
-- or their team (migration 162). Counting as the caller keeps every
-- person's numbers exactly what they were.

CREATE OR REPLACE FUNCTION public.today_insights(
  p_account_id UUID,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ
)
RETURNS TABLE (
  new_inquiries BIGINT,
  new_contacts BIGINT,
  messages_received BIGINT,
  messages_sent BIGINT,
  inbound_conversations BIGINT,
  responded_conversations BIGINT,
  showcase_opens BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH per_conversation AS (
    SELECT
      count(*) FILTER (WHERE m.sender_type = 'customer') AS received,
      count(*) FILTER (WHERE m.sender_type IS DISTINCT FROM 'customer') AS sent,
      min(m.created_at) FILTER (WHERE m.sender_type = 'customer') AS first_customer_at,
      max(m.created_at) FILTER (WHERE m.sender_type IS DISTINCT FROM 'customer') AS last_outbound_at
    FROM messages m
    WHERE m.account_id = p_account_id
      AND m.created_at >= p_start
      AND m.created_at <= p_end
    GROUP BY m.conversation_id
  ),
  message_totals AS (
    SELECT
      COALESCE(sum(pc.received), 0)::BIGINT AS received,
      COALESCE(sum(pc.sent), 0)::BIGINT AS sent,
      count(*) FILTER (WHERE pc.first_customer_at IS NOT NULL) AS inbound,
      count(*) FILTER (WHERE pc.last_outbound_at > pc.first_customer_at) AS responded
    FROM per_conversation pc
  )
  SELECT
    (SELECT count(*) FROM conversations c
      WHERE c.account_id = p_account_id
        AND c.created_at >= p_start
        AND c.created_at <= p_end),
    (SELECT count(*) FROM contacts ct
      WHERE ct.account_id = p_account_id
        AND ct.created_at >= p_start
        AND ct.created_at <= p_end),
    mt.received,
    mt.sent,
    mt.inbound,
    mt.responded,
    (SELECT count(*) FROM showcase_events se
      WHERE se.account_id = p_account_id
        AND se.event_type = 'open'
        AND se.created_at >= p_start
        AND se.created_at <= p_end)
  FROM message_totals mt
  WHERE is_account_member(p_account_id);
$$;

COMMENT ON FUNCTION public.today_insights(UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Today insights bar for one account and range in a single round trip. Replaces three count=exact requests and a read of every message row in the range, on web and mobile.';

REVOKE ALL ON FUNCTION public.today_insights(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.today_insights(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.today_insights(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
