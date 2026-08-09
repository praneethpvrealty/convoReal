-- ============================================================
-- 230_contact_lifecycle.sql
-- Two states a contact list needs to stay useful: dead and archived.
--
-- "Close my enquiry" (the quick reply on the enquiry-status and
-- enquiry-followup templates) only ever wrote
-- contacts.buyer_alerts_consent = 'declined'. That excludes the contact
-- from broadcast audiences and nothing else — automations, owner and
-- buyer digests, Match Radar, property shares and the matching engine
-- all carried on as if the lead were live. A lead who has explicitly
-- ended their enquiry is not an alerts preference; it is a dead lead.
--
--   is_dead      the lead ended it (or an agent said so). Blocks every
--                automated send and drops out of matching. An agent can
--                still reply by hand in the inbox — the composer warns
--                them first.
--   is_archived  the agent filed the contact away. Same exclusions,
--                plus it leaves the contact list. Reversible, and the
--                history (deals, messages, broadcast records) survives.
--
-- Kept as two flags rather than one state column because they answer
-- different questions and compose: a dead lead may or may not be
-- archived, and an archived contact need not be dead.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS is_dead BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS dead_at TIMESTAMPTZ;
-- 'closed_enquiry' | 'stop_alerts' | 'manual' | 'bulk_cleanup'
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS dead_reason TEXT;
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

COMMENT ON COLUMN contacts.is_dead IS
  'Lead ended their enquiry (or an agent marked it). Blocks automated sends and excludes from matching; agent-typed inbox replies are still allowed.';
COMMENT ON COLUMN contacts.is_archived IS
  'Filed away by an agent. Same exclusions as is_dead, and hidden from the contact list. Reversible.';

-- The contact list, matching feed and audience builder all read
-- "live contacts for this account" now, so index that shape.
CREATE INDEX IF NOT EXISTS idx_contacts_account_live
  ON contacts(account_id)
  WHERE NOT is_dead AND NOT is_archived;

CREATE INDEX IF NOT EXISTS idx_contacts_account_archived
  ON contacts(account_id, archived_at DESC)
  WHERE is_archived;

-- ------------------------------------------------------------
-- Bulk-cleanup candidate counts, aggregated in SQL.
--
-- The cleanup dialog has to show "how many will this affect?" before
-- the agent commits, across three conditions over every contact in the
-- account. Selecting the rows to count them in the browser would ship
-- the whole contact list on every keystroke of the day-threshold; this
-- returns three integers.
--
-- "Stale" deliberately counts inbound messages, appointments and deals
-- rather than any activity: a contact the account has been broadcasting
-- AT is not engaged, and the whole point is to find those.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contact_cleanup_counts(
  p_account_id UUID,
  p_stale_days INTEGER DEFAULT 90
)
RETURNS TABLE (
  dead_or_opted_out BIGINT,
  stale BIGINT,
  never_responded BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH live AS (
    SELECT c.id, c.created_at, c.is_dead, c.buyer_alerts_consent
    FROM contacts c
    WHERE c.account_id = p_account_id
      AND is_account_member(p_account_id)
      AND NOT c.is_archived
      AND NOT COALESCE(c.is_merged, false)
  ),
  cutoff AS (
    SELECT NOW() - make_interval(days => GREATEST(p_stale_days, 1)) AS at
  ),
  inbound AS (
    SELECT conv.contact_id, MAX(m.created_at) AS last_at, COUNT(*) AS n
    FROM messages m
    JOIN conversations conv ON conv.id = m.conversation_id
    WHERE m.account_id = p_account_id
      AND m.sender_type = 'customer'
      AND conv.contact_id IS NOT NULL
    GROUP BY conv.contact_id
  )
  SELECT
    count(*) FILTER (
      WHERE l.is_dead OR l.buyer_alerts_consent = 'declined'
    ),
    count(*) FILTER (
      WHERE COALESCE(i.last_at, l.created_at) < (SELECT at FROM cutoff)
        AND NOT EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.contact_id = l.id AND a.start_time >= (SELECT at FROM cutoff)
        )
        AND NOT EXISTS (
          SELECT 1 FROM deals d
          WHERE d.contact_id = l.id AND d.status = 'open'
        )
    ),
    count(*) FILTER (WHERE i.n IS NULL)
  FROM live l
  LEFT JOIN inbound i ON i.contact_id = l.id;
$$;

COMMENT ON FUNCTION public.contact_cleanup_counts(UUID, INTEGER) IS
  'How many live contacts match each bulk-cleanup condition. Powers the preview counts in the contacts cleanup dialog.';

REVOKE ALL ON FUNCTION public.contact_cleanup_counts(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contact_cleanup_counts(UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.contact_cleanup_counts(UUID, INTEGER) TO authenticated;

-- ------------------------------------------------------------
-- The ids behind one condition, so the bulk route acts on exactly the
-- set the agent was shown. Returns ids only — the route re-scopes
-- every write by account_id regardless.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contact_cleanup_candidates(
  p_account_id UUID,
  p_condition TEXT,
  p_stale_days INTEGER DEFAULT 90
)
RETURNS TABLE (contact_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH live AS (
    SELECT c.id, c.created_at, c.is_dead, c.buyer_alerts_consent
    FROM contacts c
    WHERE c.account_id = p_account_id
      AND is_account_member(p_account_id)
      AND NOT c.is_archived
      AND NOT COALESCE(c.is_merged, false)
  ),
  cutoff AS (
    SELECT NOW() - make_interval(days => GREATEST(p_stale_days, 1)) AS at
  ),
  inbound AS (
    SELECT conv.contact_id, MAX(m.created_at) AS last_at, COUNT(*) AS n
    FROM messages m
    JOIN conversations conv ON conv.id = m.conversation_id
    WHERE m.account_id = p_account_id
      AND m.sender_type = 'customer'
      AND conv.contact_id IS NOT NULL
    GROUP BY conv.contact_id
  )
  SELECT l.id
  FROM live l
  LEFT JOIN inbound i ON i.contact_id = l.id
  WHERE CASE p_condition
    WHEN 'dead_or_opted_out' THEN
      l.is_dead OR l.buyer_alerts_consent = 'declined'
    WHEN 'stale' THEN
      COALESCE(i.last_at, l.created_at) < (SELECT at FROM cutoff)
      AND NOT EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.contact_id = l.id AND a.start_time >= (SELECT at FROM cutoff)
      )
      AND NOT EXISTS (
        SELECT 1 FROM deals d
        WHERE d.contact_id = l.id AND d.status = 'open'
      )
    WHEN 'never_responded' THEN
      i.n IS NULL
    ELSE false
  END;
$$;

COMMENT ON FUNCTION public.contact_cleanup_candidates(UUID, TEXT, INTEGER) IS
  'Contact ids matching one bulk-cleanup condition. p_condition: dead_or_opted_out | stale | never_responded.';

REVOKE ALL ON FUNCTION public.contact_cleanup_candidates(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contact_cleanup_candidates(UUID, TEXT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.contact_cleanup_candidates(UUID, TEXT, INTEGER) TO authenticated;
