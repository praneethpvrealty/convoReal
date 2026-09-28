-- ============================================================
-- 20260928042712_co_broking_net_brokerage.sql — the dashboards count
-- the brokerage's own share.
--
-- On a co-broked deal the brokerage collects the whole commission and
-- pays the other brokers out of it (20260928042711). Every function
-- that summed brokerage summed what was collected, so a deal paying a
-- buyer's agent and a seller's agent reported their money as revenue.
-- Each now subtracts `deals.co_broker_payout_total`, floored at zero:
--
--   GREATEST(COALESCE(brokerage_amount, value * 0.02) - co_broker_payout_total, 0)
--
-- A deal with no payouts reads exactly as before.
--
-- NOT additive: CREATE OR REPLACE against four live functions. Held
-- until the PR is green and merged. Ships before the co-broking UI so
-- no payout can ever reach the board without reaching the dashboards. Bodies are the production
-- definitions with that one expression changed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.dashboard_metrics(p_account_id uuid, p_today_start timestamp with time zone, p_yesterday_start timestamp with time zone)
 RETURNS TABLE(open_conversations bigint, new_conversations_today bigint, new_conversations_yesterday bigint, new_contacts_today bigint, new_contacts_yesterday bigint, open_deals_count bigint, open_deals_value numeric, messages_today bigint, messages_yesterday bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- The account owner texting their own CRM number is not a lead.
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
    -- The brokerage's own share: brokerage when set, else the 2%
    -- fallback, less what is paid to co-brokers.
    (SELECT COALESCE(SUM(GREATEST(COALESCE(d.brokerage_amount, COALESCE(d.value, 0) * 0.02) - COALESCE(d.co_broker_payout_total, 0), 0)), 0)
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
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_pipeline_donut(p_account_id uuid)
 RETURNS TABLE(stage_id uuid, stage_name text, stage_color text, deal_count bigint, total_value numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    s.id,
    s.name,
    COALESCE(NULLIF(s.color, ''), '#64748b'),
    count(d.id),
    COALESCE(SUM(GREATEST(COALESCE(d.brokerage_amount, COALESCE(d.value, 0) * 0.02) - COALESCE(d.co_broker_payout_total, 0), 0)), 0)
  FROM pipeline_stages s
  -- pipeline_stages carries no account_id of its own; it is scoped
  -- through its parent pipeline (migration 001 + 017).
  JOIN pipelines pl
    ON pl.id = s.pipeline_id
   AND pl.account_id = p_account_id
  JOIN deals d
    ON d.stage_id = s.id
   AND d.status = 'open'
   AND d.account_id = p_account_id
  WHERE is_account_member(p_account_id)
  GROUP BY s.id, s.name, s.color, s.position
  HAVING count(d.id) > 0
  ORDER BY s.position;
$function$;

CREATE OR REPLACE FUNCTION public.team_analytics(p_account_id uuid, p_start timestamp with time zone)
 RETURNS TABLE(user_id uuid, full_name text, org_role text, team_id uuid, team_name text, messages_sent bigint, open_conversations bigint, conversations_closed bigint, deals_won bigint, deals_won_value numeric, response_samples bigint, median_response_seconds numeric, avg_response_seconds numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         COALESCE(SUM(GREATEST(COALESCE(d.brokerage_amount, COALESCE(d.value, 0) * 0.02) - COALESCE(d.co_broker_payout_total, 0), 0)), 0) AS deals_won_value
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
$function$;

CREATE OR REPLACE FUNCTION public.lead_source_analytics(p_account_id uuid, p_start timestamp with time zone)
 RETURNS TABLE(source text, contacts_added bigint, deals_created bigint, deals_won bigint, won_value numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH contact_sources AS (
    SELECT c.id,
           COALESCE(NULLIF(trim(c.source), ''), 'Unknown') AS source,
           c.created_at
    FROM contacts c
    WHERE c.account_id = p_account_id
  ),
  added AS (
    SELECT cs.source, count(*) AS contacts_added
    FROM contact_sources cs
    WHERE cs.created_at >= p_start
    GROUP BY cs.source
  ),
  created AS (
    SELECT cs.source, count(*) AS deals_created
    FROM deals d
    JOIN contact_sources cs ON cs.id = d.contact_id
    WHERE d.account_id = p_account_id
      AND d.created_at >= p_start
    GROUP BY cs.source
  ),
  won AS (
    SELECT cs.source,
           count(*) AS deals_won,
           COALESCE(SUM(GREATEST(COALESCE(d.brokerage_amount, COALESCE(d.value, 0) * 0.02) - COALESCE(d.co_broker_payout_total, 0), 0)), 0) AS won_value
    FROM deals d
    JOIN contact_sources cs ON cs.id = d.contact_id
    WHERE d.account_id = p_account_id
      AND d.status = 'won'
      AND d.updated_at >= p_start
    GROUP BY cs.source
  ),
  sources AS (
    SELECT a.source FROM added a
    UNION
    SELECT c.source FROM created c
    UNION
    SELECT w.source FROM won w
  )
  SELECT
    s.source,
    COALESCE(a.contacts_added, 0),
    COALESCE(c.deals_created, 0),
    COALESCE(w.deals_won, 0),
    COALESCE(w.won_value, 0)
  FROM sources s
  LEFT JOIN added a ON a.source = s.source
  LEFT JOIN created c ON c.source = s.source
  LEFT JOIN won w ON w.source = s.source
  WHERE is_account_member(p_account_id)
  ORDER BY COALESCE(a.contacts_added, 0) DESC, s.source;
$function$;
