-- ============================================================
-- 183_template_analytics_rpc.sql
-- Per-template performance: the join between message_templates and
-- the template_name columns that both broadcasts and messages have
-- carried since migration 001 without anything ever using them.
--
-- template_analytics(p_account_id, p_start) returns one row per
-- template with two send channels kept separate:
--   * broadcast_* — campaign totals summed from the denormalized
--     broadcasts counters (maintained by the migration 003/005
--     trigger): sent/delivered/read are cumulative ("at or past"),
--     replied/failed are terminal.
--   * direct_*    — 1:1 template sends from messages, EXCLUDING
--     broadcast deliveries: a broadcast message also lands in
--     messages, so rows whose message_id appears in
--     broadcast_recipients.whatsapp_message_id are anti-joined out
--     (unique idx_broadcast_recipients_wamid). delivered/read are
--     cumulative to match the broadcast side.
--
-- Membership-guarded, account named explicitly (pattern of
-- migrations 168-170). Rates are computed by the caller.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_messages_account_template_created
  ON messages(account_id, template_name, created_at)
  WHERE template_name IS NOT NULL;

CREATE OR REPLACE FUNCTION public.template_analytics(
  p_account_id UUID,
  p_start TIMESTAMPTZ
)
RETURNS TABLE (
  template_id UUID,
  name TEXT,
  category TEXT,
  language TEXT,
  status TEXT,
  quality_score TEXT,
  broadcast_campaigns BIGINT,
  broadcast_sent BIGINT,
  broadcast_delivered BIGINT,
  broadcast_read BIGINT,
  broadcast_replied BIGINT,
  broadcast_failed BIGINT,
  direct_sends BIGINT,
  direct_delivered BIGINT,
  direct_read BIGINT,
  direct_failed BIGINT,
  last_used_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH b AS (
    SELECT
      bc.template_name,
      count(*) AS campaigns,
      COALESCE(sum(bc.sent_count), 0) AS sent,
      COALESCE(sum(bc.delivered_count), 0) AS delivered,
      COALESCE(sum(bc.read_count), 0) AS read,
      COALESCE(sum(bc.replied_count), 0) AS replied,
      COALESCE(sum(bc.failed_count), 0) AS failed,
      max(bc.created_at) AS last_used_at
    FROM broadcasts bc
    WHERE bc.account_id = p_account_id
      AND bc.created_at >= p_start
      AND bc.status <> 'draft'
    GROUP BY bc.template_name
  ),
  m AS (
    SELECT
      msg.template_name,
      count(*) AS sends,
      count(*) FILTER (WHERE msg.status IN ('delivered', 'read')) AS delivered,
      count(*) FILTER (WHERE msg.status = 'read') AS read,
      count(*) FILTER (WHERE msg.status = 'failed') AS failed,
      max(msg.created_at) AS last_used_at
    FROM messages msg
    WHERE msg.account_id = p_account_id
      AND msg.template_name IS NOT NULL
      AND msg.sender_type <> 'customer'
      AND msg.created_at >= p_start
      AND NOT EXISTS (
        SELECT 1 FROM broadcast_recipients br
        WHERE br.whatsapp_message_id = msg.message_id
      )
    GROUP BY msg.template_name
  )
  SELECT
    t.id,
    t.name,
    t.category,
    t.language,
    t.status,
    t.quality_score,
    COALESCE(b.campaigns, 0),
    COALESCE(b.sent, 0),
    COALESCE(b.delivered, 0),
    COALESCE(b.read, 0),
    COALESCE(b.replied, 0),
    COALESCE(b.failed, 0),
    COALESCE(m.sends, 0),
    COALESCE(m.delivered, 0),
    COALESCE(m.read, 0),
    COALESCE(m.failed, 0),
    GREATEST(b.last_used_at, m.last_used_at)
  FROM message_templates t
  LEFT JOIN b ON b.template_name = t.name
  LEFT JOIN m ON m.template_name = t.name
  WHERE t.account_id = p_account_id
    AND is_account_member(p_account_id)
  ORDER BY COALESCE(b.sent, 0) + COALESCE(m.sends, 0) DESC, t.name;
$$;

COMMENT ON FUNCTION public.template_analytics(UUID, TIMESTAMPTZ) IS
  'Per-template broadcast funnel totals and direct (non-broadcast) message delivery counts for one account and range, joined on template_name. Membership-guarded.';

REVOKE ALL ON FUNCTION public.template_analytics(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.template_analytics(UUID, TIMESTAMPTZ) TO authenticated;
