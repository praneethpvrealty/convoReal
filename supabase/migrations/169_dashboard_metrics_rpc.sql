-- ============================================================
-- 169_dashboard_metrics_rpc.sql
-- Collapse the dashboard metric cards from nine round trips to one.
--
-- loadMetrics() in src/lib/dashboard/queries.ts issued:
--   1  SELECT of every archived conversation's contact_id, whose ids
--      were then interpolated into a `not.in.(...)` filter on the two
--      contact counts. That list is unbounded — an account with a few
--      thousand archived conversations builds a URL filter thousands
--      of uuids long, on every dashboard load.
--   8  further queries, six of them `count: 'exact'` (real COUNT(*)s)
--      and one fetching every open deal row purely to sum it in JS.
--
-- All of it is one statement's worth of work. The archived-contact
-- exclusion becomes a NOT EXISTS correlated subquery instead of a
-- materialised id list, and the deal total becomes a SUM.
--
-- The old queries carried no account filter at all and leaned entirely
-- on RLS. This function is SECURITY DEFINER, so it takes the account
-- explicitly and checks membership up front.
-- ============================================================

-- Supports the two contact windows and the archived-contact exclusion.
CREATE INDEX IF NOT EXISTS idx_contacts_account_created
  ON contacts(account_id, created_at);

-- Supports both conversation windows plus the open/archived filters.
CREATE INDEX IF NOT EXISTS idx_conversations_account_status_created
  ON conversations(account_id, status, is_archived, created_at);

-- Agent messages per day, already narrowed by conversation.
CREATE INDEX IF NOT EXISTS idx_messages_account_sender_created
  ON messages(account_id, sender_type, created_at);

CREATE OR REPLACE FUNCTION public.dashboard_metrics(
  p_account_id UUID,
  p_today_start TIMESTAMPTZ,
  p_yesterday_start TIMESTAMPTZ
)
RETURNS TABLE (
  open_conversations BIGINT,
  new_conversations_today BIGINT,
  new_conversations_yesterday BIGINT,
  new_contacts_today BIGINT,
  new_contacts_yesterday BIGINT,
  open_deals_count BIGINT,
  open_deals_value NUMERIC,
  messages_today BIGINT,
  messages_yesterday BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM conversations c
      WHERE c.account_id = p_account_id
        AND c.status = 'open' AND c.is_archived = false),
    (SELECT count(*) FROM conversations c
      WHERE c.account_id = p_account_id
        AND c.status = 'open' AND c.is_archived = false
        AND c.created_at >= p_today_start),
    (SELECT count(*) FROM conversations c
      WHERE c.account_id = p_account_id
        AND c.status = 'open' AND c.is_archived = false
        AND c.created_at >= p_yesterday_start
        AND c.created_at < p_today_start),

    -- The account owner texting their own Engine number is not a lead.
    -- Those self-chats are archived, and contacts carry no archive
    -- flag, so the owner's own contact is excluded by the archived
    -- conversation that points at it.
    (SELECT count(*) FROM contacts ct
      WHERE ct.account_id = p_account_id
        AND ct.created_at >= p_today_start
        AND NOT EXISTS (
          SELECT 1 FROM conversations c
          WHERE c.contact_id = ct.id AND c.is_archived = true
        )),
    (SELECT count(*) FROM contacts ct
      WHERE ct.account_id = p_account_id
        AND ct.created_at >= p_yesterday_start
        AND ct.created_at < p_today_start
        AND NOT EXISTS (
          SELECT 1 FROM conversations c
          WHERE c.contact_id = ct.id AND c.is_archived = true
        )),

    (SELECT count(*) FROM deals d
      WHERE d.account_id = p_account_id AND d.status = 'open'),
    -- Brokerage amount when set, else the 2% fallback the dashboard
    -- has always applied.
    (SELECT COALESCE(SUM(COALESCE(d.brokerage_amount, COALESCE(d.value, 0) * 0.02)), 0)
       FROM deals d
      WHERE d.account_id = p_account_id AND d.status = 'open'),

    (SELECT count(*) FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.account_id = p_account_id
        AND m.sender_type = 'agent'
        AND c.is_archived = false
        AND m.created_at >= p_today_start),
    (SELECT count(*) FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.account_id = p_account_id
        AND m.sender_type = 'agent'
        AND c.is_archived = false
        AND m.created_at >= p_yesterday_start
        AND m.created_at < p_today_start)
  WHERE is_account_member(p_account_id);
$$;

COMMENT ON FUNCTION public.dashboard_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Dashboard metric cards for one account in a single round trip. Replaces nine queries, one of which interpolated an unbounded contact-id list into a NOT IN filter.';

REVOKE ALL ON FUNCTION public.dashboard_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dashboard_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.dashboard_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
