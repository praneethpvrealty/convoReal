-- ============================================================
-- 20261003124115_reengagement_leads_sort.sql
-- Server-side sort for the Re-engagement leads table.
--
-- reengagement_leads (migration 212) paginates with p_limit/p_offset
-- behind one fixed ORDER BY, so a sort applied in the browser could
-- only reorder the page already loaded: "most matches first" showed
-- the best of those 100 rows, not the best of the batch. The order has
-- to be chosen before LIMIT/OFFSET, which means here.
--
-- p_sort takes:
--   batch         the standing order, most actionable first (default)
--   matches_desc  most matches first
--   matches_asc   fewest matches first
--   replied_desc  newest reply first
--   replied_asc   oldest reply first
-- A lead that never replied sorts last in both reply directions, and
-- any other value falls back to 'batch'. Ties keep the standing order,
-- and the recipient id closes the ordering so two pages can never share
-- or skip a row.
--
-- The new parameter changes the signature, so the old function is
-- dropped rather than left as an overload PostgREST could not choose
-- between. A caller that still sends the five original arguments
-- resolves to this function through the p_sort default.
-- ============================================================

DROP FUNCTION IF EXISTS public.reengagement_leads(UUID, UUID, BOOLEAN, INT, INT);

CREATE OR REPLACE FUNCTION public.reengagement_leads(
  p_account_id UUID,
  p_broadcast_id UUID DEFAULT NULL,
  p_only_matched BOOLEAN DEFAULT FALSE,
  p_limit INT DEFAULT 200,
  p_offset INT DEFAULT 0,
  p_sort TEXT DEFAULT 'batch'
)
RETURNS TABLE (
  contact_id UUID,
  contact_name TEXT,
  contact_phone TEXT,
  broadcast_id UUID,
  broadcast_name TEXT,
  batch_sent_at TIMESTAMPTZ,
  status TEXT,
  replied_at TIMESTAMPTZ,
  requirement_updated_at TIMESTAMPTZ,
  budget_min NUMERIC,
  budget_max NUMERIC,
  areas TEXT[],
  match_event_id UUID,
  match_count INT,
  match_event_status TEXT,
  total_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH batch AS (
    SELECT b.id, b.name, b.created_at
      FROM broadcasts b
     WHERE b.account_id = p_account_id
       AND is_reengagement_template(b.template_name)
       AND (p_broadcast_id IS NULL OR b.id = p_broadcast_id)
  ),
  lead AS (
    SELECT
      r.id                AS recipient_id,
      c.id                AS contact_id,
      c.name              AS contact_name,
      c.phone             AS contact_phone,
      bt.id               AS broadcast_id,
      bt.name             AS broadcast_name,
      bt.created_at       AS batch_sent_at,
      r.status            AS status,
      r.replied_at        AS replied_at,
      GREATEST(
        (SELECT max(s.completed_at) FROM whatsapp_meta_flow_sessions s
          WHERE s.contact_id = c.id
            AND s.account_id = p_account_id
            AND s.flow_key = 'preference_intake'
            AND s.status = 'completed'
            AND s.completed_at >= bt.created_at),
        CASE WHEN c.pref_extracted_at >= bt.created_at THEN c.pref_extracted_at END
      )                   AS requirement_updated_at,
      COALESCE(c.pref_budget_min, c.min_budget)  AS budget_min,
      COALESCE(c.pref_budget_max, c.max_budget)  AS budget_max,
      COALESCE(NULLIF(c.pref_areas, '{}'::TEXT[]), c.areas_of_interest) AS areas,
      m.id                AS match_event_id,
      COALESCE(jsonb_array_length(m.matches), 0) AS match_count,
      m.status            AS match_event_status
    FROM broadcast_recipients r
    JOIN batch bt   ON bt.id = r.broadcast_id
    JOIN contacts c ON c.id = r.contact_id AND c.account_id = p_account_id
    -- Newest buyer_updated event for this lead since the batch went out;
    -- LATERAL keeps it one indexed lookup per lead rather than a join
    -- against every event in the account.
    LEFT JOIN LATERAL (
      SELECT me.id, me.matches, me.status
        FROM match_events me
       WHERE me.account_id = p_account_id
         AND me.contact_id = c.id
         AND me.kind = 'buyer_updated'
         AND me.created_at >= bt.created_at
       ORDER BY me.created_at DESC
       LIMIT 1
    ) m ON TRUE
  ),
  filtered AS (
    SELECT * FROM lead
     WHERE NOT p_only_matched OR match_count > 0
  )
  SELECT f.contact_id, f.contact_name, f.contact_phone, f.broadcast_id,
         f.broadcast_name, f.batch_sent_at, f.status, f.replied_at,
         f.requirement_updated_at, f.budget_min, f.budget_max, f.areas,
         f.match_event_id, f.match_count, f.match_event_status,
         (SELECT count(*) FROM filtered)
    FROM filtered f
   WHERE is_account_member(p_account_id)
   -- The requested column first. Each CASE is NULL for every row unless
   -- its sort was asked for, so at most one of the four decides.
   ORDER BY CASE WHEN p_sort = 'matches_desc' THEN f.match_count END DESC NULLS LAST,
            CASE WHEN p_sort = 'matches_asc'  THEN f.match_count END ASC  NULLS LAST,
            CASE WHEN p_sort = 'replied_desc' THEN f.replied_at  END DESC NULLS LAST,
            CASE WHEN p_sort = 'replied_asc'  THEN f.replied_at  END ASC  NULLS LAST,
            -- Then the standing order, which is the whole order for
            -- 'batch': matched leads, then repliers, newest batch.
            f.match_count DESC,
            f.requirement_updated_at DESC NULLS LAST,
            f.replied_at DESC NULLS LAST,
            f.batch_sent_at DESC,
            f.recipient_id
   LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0);
$$;

COMMENT ON FUNCTION public.reengagement_leads(UUID, UUID, BOOLEAN, INT, INT, TEXT) IS
  'Per-lead re-engagement outcome with the newest buyer_updated match event, for shortlisting. p_broadcast_id NULL spans every batch. p_sort orders the whole result before pagination: batch (default), matches_desc, matches_asc, replied_desc, replied_asc.';

REVOKE ALL ON FUNCTION public.reengagement_leads(UUID, UUID, BOOLEAN, INT, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reengagement_leads(UUID, UUID, BOOLEAN, INT, INT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.reengagement_leads(UUID, UUID, BOOLEAN, INT, INT, TEXT) TO authenticated;
