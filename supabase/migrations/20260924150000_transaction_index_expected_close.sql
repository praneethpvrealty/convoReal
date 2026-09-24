-- ============================================================
-- 20260924150000_transaction_index_expected_close.sql — the Records
-- index carries the deal's expected close date.
--
-- transaction_workspace_index (migration 20260918010000) heads each
-- record with buyer, property, stage and milestone progress; the one
-- date the agent forecast at the start was not on it, so the list
-- could not be read or sorted by when a deal is meant to close.
--
-- A RETURNS TABLE cannot gain a column through CREATE OR REPLACE, so
-- the function is dropped and recreated with expected_close_date and
-- actual_close_date appended. Every reader names its columns.
--
-- Replaces a function production runs: HELD until the pull request is
-- merged, then applied. Idempotent — safe to run multiple times.
-- ============================================================

DROP FUNCTION IF EXISTS transaction_workspace_index(UUID);

CREATE FUNCTION transaction_workspace_index(target_account_id UUID)
RETURNS TABLE (
  id UUID,
  title TEXT,
  status TEXT,
  value NUMERIC,
  currency TEXT,
  stage_name TEXT,
  stage_color TEXT,
  contact_name TEXT,
  property_title TEXT,
  property_unit_no TEXT,
  deal_group_id UUID,
  group_name TEXT,
  source_journey_item_id UUID,
  milestones_total INTEGER,
  milestones_done INTEGER,
  next_milestone_title TEXT,
  next_milestone_target_date DATE,
  updated_at TIMESTAMPTZ,
  expected_close_date DATE,
  actual_close_date DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.title,
    d.status,
    d.value,
    d.currency,
    s.name,
    s.color,
    NULLIF(TRIM(CONCAT_WS(' ', c.name, c.second_name)), ''),
    p.title,
    p.unit_no,
    d.deal_group_id,
    g.name,
    d.source_journey_item_id,
    COALESCE(m.total, 0)::INTEGER,
    COALESCE(m.done, 0)::INTEGER,
    nm.title,
    nm.target_date,
    d.updated_at,
    d.expected_close_date,
    d.actual_close_date
  FROM deals d
  LEFT JOIN pipeline_stages s ON s.id = d.stage_id
  LEFT JOIN contacts c ON c.id = d.contact_id AND c.account_id = target_account_id
  LEFT JOIN properties p ON p.id = d.property_id AND p.account_id = target_account_id
  LEFT JOIN deal_groups g ON g.id = d.deal_group_id AND g.account_id = target_account_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE dm.status IN ('completed', 'skipped')) AS done
    FROM deal_milestones dm
    WHERE dm.deal_id = d.id
  ) m ON TRUE
  LEFT JOIN LATERAL (
    SELECT dm.title, dm.target_date
    FROM deal_milestones dm
    WHERE dm.deal_id = d.id
      AND dm.status IN ('pending', 'in_progress')
    ORDER BY dm.position
    LIMIT 1
  ) nm ON TRUE
  WHERE d.account_id = target_account_id
    AND is_account_member(target_account_id)
  ORDER BY d.updated_at DESC;
$$;

REVOKE ALL ON FUNCTION transaction_workspace_index(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transaction_workspace_index(UUID) TO authenticated;
