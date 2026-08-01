-- ============================================================
-- 184_lead_source_analytics_rpc.sql
-- Where leads come from. contacts.source (migration 041) has been
-- stamped by every ingestion path — WhatsApp, the portal email
-- webhook (MagicBricks / Housing / 99acres), manual entry — but
-- never aggregated, and email_sync_logs (migration 060) is written
-- on every inbound portal email with no reader at all.
--
--   lead_source_analytics — per normalized source: contacts added
--     in range, deals created on those contacts in range, deals won
--     in range (by updated_at, matching how the pipeline analytics
--     treat close time) with brokerage value. A source appears if
--     any of the three touched it, so a quiet source that closed an
--     old lead still shows its win.
--   email_sync_health — success/failed/ignored counts and last
--     event per status from email_sync_logs.
--
-- Both membership-guarded with the account named explicitly
-- (pattern of migrations 168-170).
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_email_sync_logs_account_created
  ON email_sync_logs(account_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.lead_source_analytics(
  p_account_id UUID,
  p_start TIMESTAMPTZ
)
RETURNS TABLE (
  source TEXT,
  contacts_added BIGINT,
  deals_created BIGINT,
  deals_won BIGINT,
  won_value NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
           COALESCE(SUM(COALESCE(d.brokerage_amount, COALESCE(d.value, 0) * 0.02)), 0) AS won_value
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
$$;

CREATE OR REPLACE FUNCTION public.email_sync_health(
  p_account_id UUID,
  p_start TIMESTAMPTZ
)
RETURNS TABLE (
  status TEXT,
  events BIGINT,
  last_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.status, count(*), max(l.created_at)
  FROM email_sync_logs l
  WHERE l.account_id = p_account_id
    AND l.created_at >= p_start
    AND is_account_member(p_account_id)
  GROUP BY l.status;
$$;

COMMENT ON FUNCTION public.lead_source_analytics(UUID, TIMESTAMPTZ) IS
  'Per-source contact and deal attribution for one account and range: contacts added, deals created and deals won (with brokerage value) grouped by the contact''s normalized source. Membership-guarded.';
COMMENT ON FUNCTION public.email_sync_health(UUID, TIMESTAMPTZ) IS
  'email_sync_logs status rollup (success/failed/ignored counts and last event) for one account and range. Membership-guarded.';

REVOKE ALL ON FUNCTION public.lead_source_analytics(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.email_sync_health(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_source_analytics(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.email_sync_health(UUID, TIMESTAMPTZ) TO authenticated;
