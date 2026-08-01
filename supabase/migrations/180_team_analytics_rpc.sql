-- ============================================================
-- 180_team_analytics_rpc.sql
-- Per-agent team analytics in one round trip — the feature the
-- pricing page has been advertising ("Team analytics" on the Team
-- plan, "Org-wide analytics" on Agency) without a backing surface.
--
-- team_analytics(p_account_id, p_start) returns one row per account
-- member: messages sent, current open conversations, conversations
-- closed in range, deals won (count + brokerage value, using the
-- same COALESCE(brokerage_amount, value * 0.02) fallback as the
-- dashboard), and first-response stats (sample count, median, mean)
-- attributed to the agent whose message answered the customer.
-- Response pairing reuses the out_seq block walk from
-- dashboard_response_samples (migration 170); bot replies close a
-- block but are not credited to any agent.
--
-- Access is enforced inside the function, because SECURITY DEFINER
-- bypasses the per-agent conversation RLS from the org hierarchy
-- (migration 082):
--   * caller must be a member of the account,
--   * the account's plan must have has_teams (Team or Agency),
--   * owners/admins/org_managers see every member (org-wide),
--     org_leaders see only their own team,
--   * org_agents and viewers get no rows.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_conversations_account_agent_status
  ON conversations(account_id, assigned_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_deals_account_user_status
  ON deals(account_id, user_id, status);

CREATE OR REPLACE FUNCTION public.team_analytics(
  p_account_id UUID,
  p_start TIMESTAMPTZ
)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  org_role TEXT,
  team_id UUID,
  team_name TEXT,
  messages_sent BIGINT,
  open_conversations BIGINT,
  conversations_closed BIGINT,
  deals_won BIGINT,
  deals_won_value NUMERIC,
  response_samples BIGINT,
  median_response_seconds NUMERIC,
  avg_response_seconds NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH viewer AS (
  SELECT p.account_role, p.org_role, p.team_id
  FROM profiles p
  WHERE p.user_id = auth.uid()
    AND p.account_id = p_account_id
),
allowed AS (
  SELECT
    (
      is_account_member(p_account_id)
      AND EXISTS (
        SELECT 1 FROM account_plan_limits l
        WHERE l.account_id = p_account_id AND l.has_teams
      )
      AND EXISTS (
        SELECT 1 FROM viewer v
        WHERE v.account_role IN ('owner', 'admin')
           OR v.org_role IN ('org_manager', 'org_leader')
      )
    ) AS ok,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM viewer v
        WHERE v.account_role IN ('owner', 'admin') OR v.org_role = 'org_manager'
      ) THEN NULL
      ELSE (SELECT v.team_id FROM viewer v)
    END AS scope_team_id
),
roster AS (
  SELECT p.user_id, p.full_name, p.org_role::text AS org_role, p.team_id,
         t.name AS team_name
  FROM profiles p
  LEFT JOIN teams t ON t.id = p.team_id
  CROSS JOIN allowed a
  WHERE p.account_id = p_account_id
    AND a.ok
    AND (a.scope_team_id IS NULL OR p.team_id = a.scope_team_id)
),
msg AS (
  SELECT m.sender_id AS uid, count(*) AS messages_sent
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE m.account_id = p_account_id
    AND m.sender_type = 'agent'
    AND m.sender_id IS NOT NULL
    AND c.is_archived = false
    AND m.created_at >= p_start
    AND (SELECT ok FROM allowed)
  GROUP BY m.sender_id
),
convs AS (
  SELECT c.assigned_agent_id AS uid,
         count(*) FILTER (
           WHERE c.status = 'open' AND c.is_archived = false
         ) AS open_conversations,
         count(*) FILTER (
           WHERE c.status = 'closed' AND c.updated_at >= p_start
         ) AS conversations_closed
  FROM conversations c
  WHERE c.account_id = p_account_id
    AND c.assigned_agent_id IS NOT NULL
    AND (SELECT ok FROM allowed)
  GROUP BY c.assigned_agent_id
),
dl AS (
  SELECT d.user_id AS uid, count(*) AS deals_won,
         COALESCE(SUM(COALESCE(d.brokerage_amount, COALESCE(d.value, 0) * 0.02)), 0) AS deals_won_value
  FROM deals d
  WHERE d.account_id = p_account_id
    AND d.status = 'won'
    AND d.updated_at >= p_start
    AND (SELECT ok FROM allowed)
  GROUP BY d.user_id
),
ordered AS (
  SELECT
    m.conversation_id,
    m.sender_type,
    m.sender_id,
    m.created_at,
    SUM(CASE WHEN m.sender_type <> 'customer' THEN 1 ELSE 0 END) OVER (
      PARTITION BY m.conversation_id
      ORDER BY m.created_at
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS out_seq
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE m.account_id = p_account_id
    AND c.is_archived = false
    AND m.created_at >= p_start
    AND (SELECT ok FROM allowed)
),
waiting AS (
  SELECT o.conversation_id, o.out_seq AS blk, MIN(o.created_at) AS customer_at
  FROM ordered o
  WHERE o.sender_type = 'customer'
  GROUP BY o.conversation_id, o.out_seq
),
replies AS (
  SELECT DISTINCT ON (o.conversation_id, o.out_seq)
         o.conversation_id, o.out_seq AS blk, o.created_at AS response_at,
         o.sender_type, o.sender_id
  FROM ordered o
  WHERE o.sender_type <> 'customer'
  ORDER BY o.conversation_id, o.out_seq, o.created_at
),
pairs AS (
  SELECT r.sender_id AS uid,
         EXTRACT(EPOCH FROM (r.response_at - w.customer_at)) AS seconds
  FROM waiting w
  JOIN replies r
    ON r.conversation_id = w.conversation_id
   AND r.blk = w.blk + 1
  WHERE r.response_at >= w.customer_at
    AND r.sender_type = 'agent'
    AND r.sender_id IS NOT NULL
),
resp AS (
  SELECT p.uid,
         count(*) AS response_samples,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY p.seconds) AS median_response_seconds,
         avg(p.seconds) AS avg_response_seconds
  FROM pairs p
  GROUP BY p.uid
)
SELECT
  r.user_id,
  r.full_name,
  r.org_role,
  r.team_id,
  r.team_name,
  COALESCE(msg.messages_sent, 0),
  COALESCE(convs.open_conversations, 0),
  COALESCE(convs.conversations_closed, 0),
  COALESCE(dl.deals_won, 0),
  COALESCE(dl.deals_won_value, 0),
  COALESCE(resp.response_samples, 0),
  resp.median_response_seconds,
  resp.avg_response_seconds
FROM roster r
LEFT JOIN msg   ON msg.uid = r.user_id
LEFT JOIN convs ON convs.uid = r.user_id
LEFT JOIN dl    ON dl.uid = r.user_id
LEFT JOIN resp  ON resp.uid = r.user_id
ORDER BY COALESCE(msg.messages_sent, 0) DESC, r.full_name;
$$;

COMMENT ON FUNCTION public.team_analytics(UUID, TIMESTAMPTZ) IS
  'Per-agent team analytics (messages, conversations, won deals, first-response stats) for one account and range. Role- and plan-gated inside the function: has_teams plan required; owners/admins/org_managers see all members, org_leaders their own team, everyone else nothing.';

REVOKE ALL ON FUNCTION public.team_analytics(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.team_analytics(UUID, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.team_analytics(UUID, TIMESTAMPTZ) TO authenticated;
