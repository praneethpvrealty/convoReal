-- ============================================================
-- 20260924103000_deal_deadlines.sql — the dates a closing record
-- carries, gathered in one place.
--
-- A milestone's target_date and a deal's expected_close_date were
-- stored and shown on the record, and nothing watched them: the
-- closing card clocks stage movement, the task digest lists to-dos.
-- A registration due on the 10th slipped as quietly as one with no
-- date at all. These two functions are the single rule for "which
-- deal dates are due": Focus, Today and the agent task digest all
-- read them, so the three surfaces cannot disagree about what is due.
--
-- `deal_deadlines_for_account` is the unguarded twin for the service
-- role (the digest runs as it, with no auth.uid()); `deal_deadlines`
-- is the member-facing wrapper guarded by is_account_member, the same
-- split as journey_stages_for_account / sync_journey_stages_from_pipeline.
--
-- "Today" is passed in rather than read from current_date: the caller
-- knows its calendar (IST for the digest, the browser's for the web),
-- the database does not.
--
-- Purely additive: two new functions and two partial indexes.
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_deal_milestones_due
  ON deal_milestones (account_id, target_date)
  WHERE target_date IS NOT NULL AND status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_deals_expected_close
  ON deals (account_id, expected_close_date)
  WHERE expected_close_date IS NOT NULL AND actual_close_date IS NULL;

CREATE OR REPLACE FUNCTION deal_deadlines_for_account(
  p_account_id UUID,
  p_today DATE,
  p_horizon_days INTEGER DEFAULT 14
)
RETURNS TABLE (
  deal_id UUID,
  deal_title TEXT,
  contact_name TEXT,
  property_title TEXT,
  property_unit_no TEXT,
  kind TEXT,
  milestone_id UUID,
  title TEXT,
  due_date DATE,
  assigned_to UUID,
  owner_user_id UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.title,
    NULLIF(TRIM(CONCAT_WS(' ', c.name, c.second_name)), ''),
    p.title,
    p.unit_no,
    'milestone'::TEXT,
    m.id,
    m.title,
    m.target_date,
    d.assigned_to,
    d.user_id
  FROM deal_milestones m
  JOIN deals d ON d.id = m.deal_id
  LEFT JOIN contacts c ON c.id = d.contact_id
  LEFT JOIN properties p ON p.id = d.property_id
  WHERE m.account_id = p_account_id
    AND d.account_id = p_account_id
    AND COALESCE(d.status, 'open') NOT IN ('won', 'lost')
    AND m.status IN ('pending', 'in_progress')
    AND m.target_date IS NOT NULL
    AND m.target_date <= p_today + p_horizon_days
  UNION ALL
  SELECT
    d.id,
    d.title,
    NULLIF(TRIM(CONCAT_WS(' ', c.name, c.second_name)), ''),
    p.title,
    p.unit_no,
    'expected_close'::TEXT,
    NULL::UUID,
    'Expected close'::TEXT,
    d.expected_close_date,
    d.assigned_to,
    d.user_id
  FROM deals d
  LEFT JOIN contacts c ON c.id = d.contact_id
  LEFT JOIN properties p ON p.id = d.property_id
  WHERE d.account_id = p_account_id
    AND COALESCE(d.status, 'open') NOT IN ('won', 'lost')
    AND d.actual_close_date IS NULL
    AND d.expected_close_date IS NOT NULL
    AND d.expected_close_date <= p_today + p_horizon_days
  ORDER BY 9, 6 DESC, 8;
$$;

REVOKE ALL ON FUNCTION deal_deadlines_for_account(UUID, DATE, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION deal_deadlines_for_account(UUID, DATE, INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION deal_deadlines(
  target_account_id UUID,
  p_today DATE,
  p_horizon_days INTEGER DEFAULT 14
)
RETURNS TABLE (
  deal_id UUID,
  deal_title TEXT,
  contact_name TEXT,
  property_title TEXT,
  property_unit_no TEXT,
  kind TEXT,
  milestone_id UUID,
  title TEXT,
  due_date DATE,
  assigned_to UUID,
  owner_user_id UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM deal_deadlines_for_account(target_account_id, p_today, p_horizon_days)
  WHERE is_account_member(target_account_id);
$$;

REVOKE ALL ON FUNCTION deal_deadlines(UUID, DATE, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION deal_deadlines(UUID, DATE, INTEGER) TO authenticated;

COMMENT ON FUNCTION deal_deadlines_for_account(UUID, DATE, INTEGER) IS
  'Open milestone target dates and expected close dates on live deals, due within the horizon. Service role only; deal_deadlines is the member-facing wrapper.';
COMMENT ON FUNCTION deal_deadlines(UUID, DATE, INTEGER) IS
  'deal_deadlines_for_account guarded by is_account_member. Focus, Today and the agent digest read due deal dates through this one rule.';
