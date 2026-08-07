-- ============================================================
-- 212_reengagement_outcome_rpc.sql
-- Outcome reporting for portal-lead re-engagement campaigns.
--
-- A re-engagement batch is a broadcast sent on the enquiry-status
-- template: old portal leads whose original listing expired are asked
-- for their current requirement. What the agent needs afterwards is not
-- the send funnel alone but the shortlisting funnel — who replied, who
-- restated a requirement, and which inventory now matches them.
--
-- That spans four tables (broadcast_recipients, contacts,
-- whatsapp_meta_flow_sessions, match_events). Assembling it in the
-- browser would mean one query per stage plus an unbounded contact-id
-- list interpolated into `.in()` filters, so it is one statement here
-- instead, per the aggregation rule in AGENTS.md §2.6.
--
-- Both functions take the account explicitly and check membership, and
-- p_broadcast_id NULL means "every re-engagement batch" — the standing
-- view — while a value scopes to one batch.
--
-- "Requirement updated" is deliberately two signals ORed together: a
-- completed preference Flow (the structured path, exact) or a fresh AI
-- preference extraction after the send (the free-text path, since a
-- lead may simply type "looking for 3BHK in Whitefield"). Counting only
-- the Flow would under-report every lead who just replied normally.
-- ============================================================

-- Recipient lookups are always per-broadcast and ordered by outcome.
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_contact
  ON broadcast_recipients(broadcast_id, contact_id);

-- The per-contact 'buyer_updated' lookup behind every lead row.
CREATE INDEX IF NOT EXISTS idx_match_events_account_contact_kind
  ON match_events(account_id, contact_id, kind, created_at DESC);

-- Completed preference submissions per contact.
CREATE INDEX IF NOT EXISTS idx_flow_sessions_contact_status
  ON whatsapp_meta_flow_sessions(contact_id, flow_key, status);

-- The broadcasts that count as re-engagement sends. Kept as a function
-- so the template names live in exactly one place; the pre-rename name
-- is included because a batch sent on it is still a re-engagement batch.
CREATE OR REPLACE FUNCTION public.is_reengagement_template(p_template_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_template_name IN ('property_enquiry_status', 'property_enquiry_followup');
$$;

-- ============================================================
-- Funnel counts for one batch, or across every batch.
-- ============================================================
CREATE OR REPLACE FUNCTION public.reengagement_summary(
  p_account_id UUID,
  p_broadcast_id UUID DEFAULT NULL
)
-- Output names carry a _count suffix so none of them shadows a column
-- referenced unqualified in the body (`read` in particular is a keyword
-- in enough dialects to be worth avoiding).
RETURNS TABLE (
  batch_count BIGINT,
  lead_count BIGINT,
  sent_count BIGINT,
  delivered_count BIGINT,
  read_count BIGINT,
  replied_count BIGINT,
  requirement_updated_count BIGINT,
  matched_count BIGINT,
  failed_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH batch AS (
    SELECT b.id, b.created_at
      FROM broadcasts b
     WHERE b.account_id = p_account_id
       AND is_reengagement_template(b.template_name)
       AND (p_broadcast_id IS NULL OR b.id = p_broadcast_id)
  ),
  recipient AS (
    -- One row per lead per batch. A contact re-sent in a later batch is
    -- counted once per batch, which is what a per-batch funnel means.
    SELECT r.contact_id,
           r.status,
           r.replied_at,
           bt.created_at AS batch_sent_at
      FROM broadcast_recipients r
      JOIN batch bt ON bt.id = r.broadcast_id
  )
  SELECT
    (SELECT count(*) FROM batch),
    (SELECT count(*) FROM recipient),
    (SELECT count(*) FROM recipient rc WHERE rc.status NOT IN ('pending', 'failed')),
    (SELECT count(*) FROM recipient rc WHERE rc.status IN ('delivered', 'read', 'replied')),
    (SELECT count(*) FROM recipient rc WHERE rc.status IN ('read', 'replied')),
    (SELECT count(*) FROM recipient rc WHERE rc.status = 'replied' OR rc.replied_at IS NOT NULL),
    (SELECT count(*) FROM recipient rc
      WHERE EXISTS (
              SELECT 1 FROM whatsapp_meta_flow_sessions s
               WHERE s.contact_id = rc.contact_id
                 AND s.account_id = p_account_id
                 AND s.flow_key = 'preference_intake'
                 AND s.status = 'completed'
                 AND s.completed_at >= rc.batch_sent_at)
         OR EXISTS (
              SELECT 1 FROM contacts c
               WHERE c.id = rc.contact_id
                 AND c.account_id = p_account_id
                 AND c.pref_extracted_at >= rc.batch_sent_at)),
    (SELECT count(*) FROM recipient rc
      WHERE EXISTS (
              SELECT 1 FROM match_events m
               WHERE m.account_id = p_account_id
                 AND m.contact_id = rc.contact_id
                 AND m.kind = 'buyer_updated'
                 AND m.created_at >= rc.batch_sent_at
                 AND jsonb_array_length(m.matches) > 0)),
    (SELECT count(*) FROM recipient rc WHERE rc.status = 'failed')
  WHERE is_account_member(p_account_id);
$$;

COMMENT ON FUNCTION public.reengagement_summary(UUID, UUID) IS
  'Re-engagement funnel (sent → replied → requirement updated → matched) for one batch, or all batches when p_broadcast_id is NULL.';

REVOKE ALL ON FUNCTION public.reengagement_summary(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reengagement_summary(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.reengagement_summary(UUID, UUID) TO authenticated;

-- ============================================================
-- Per-lead rows: who they are, where they stopped, and what matches
-- them now. match_event_id + match_count feed the shortlist picker,
-- which sends the chosen properties through /api/radar/send.
-- ============================================================
CREATE OR REPLACE FUNCTION public.reengagement_leads(
  p_account_id UUID,
  p_broadcast_id UUID DEFAULT NULL,
  p_only_matched BOOLEAN DEFAULT FALSE,
  p_limit INT DEFAULT 200,
  p_offset INT DEFAULT 0
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
   -- Most actionable first: matched leads, then repliers, newest batch.
   ORDER BY f.match_count DESC,
            f.requirement_updated_at DESC NULLS LAST,
            f.replied_at DESC NULLS LAST,
            f.batch_sent_at DESC
   LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0);
$$;

COMMENT ON FUNCTION public.reengagement_leads(UUID, UUID, BOOLEAN, INT, INT) IS
  'Per-lead re-engagement outcome with the newest buyer_updated match event, for shortlisting. p_broadcast_id NULL spans every batch.';

REVOKE ALL ON FUNCTION public.reengagement_leads(UUID, UUID, BOOLEAN, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reengagement_leads(UUID, UUID, BOOLEAN, INT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.reengagement_leads(UUID, UUID, BOOLEAN, INT, INT) TO authenticated;

-- ============================================================
-- The batch list itself, for the standing view's filter.
-- ============================================================
CREATE OR REPLACE FUNCTION public.reengagement_batches(p_account_id UUID)
RETURNS TABLE (
  broadcast_id UUID,
  broadcast_name TEXT,
  sent_at TIMESTAMPTZ,
  status TEXT,
  total_recipients INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.name, b.created_at, b.status, b.total_recipients
    FROM broadcasts b
   WHERE b.account_id = p_account_id
     AND is_reengagement_template(b.template_name)
     AND is_account_member(p_account_id)
   ORDER BY b.created_at DESC;
$$;

COMMENT ON FUNCTION public.reengagement_batches(UUID) IS
  'Re-engagement broadcasts for the account, newest first — the batch filter behind the standing outcome view.';

REVOKE ALL ON FUNCTION public.reengagement_batches(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reengagement_batches(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.reengagement_batches(UUID) TO authenticated;
