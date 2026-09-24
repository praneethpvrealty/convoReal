-- ============================================================
-- 20260924140100_deal_deadlines_payment_tranches.sql — an unpaid
-- tranche's due date is a deadline.
--
-- Adds a third branch to deal_deadlines_for_account (migration
-- 20260924103000): a payment tranche with a due date and no receipt,
-- on a live deal, within the horizon. The member wrapper
-- deal_deadlines is unchanged and picks the branch up through it.
--
-- CREATE OR REPLACE against a function production already runs:
-- HELD until the pull request is merged, then applied.
-- Idempotent — safe to run multiple times.
-- ============================================================

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
  LEFT JOIN contacts c ON c.id = d.contact_id AND c.account_id = p_account_id
  LEFT JOIN properties p ON p.id = d.property_id AND p.account_id = p_account_id
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
    'payment'::TEXT,
    t.id,
    'Payment: ' || t.label,
    t.due_date,
    d.assigned_to,
    d.user_id
  FROM deal_payment_tranches t
  JOIN deals d ON d.id = t.deal_id
  LEFT JOIN contacts c ON c.id = d.contact_id AND c.account_id = p_account_id
  LEFT JOIN properties p ON p.id = d.property_id AND p.account_id = p_account_id
  WHERE t.account_id = p_account_id
    AND d.account_id = p_account_id
    AND COALESCE(d.status, 'open') NOT IN ('won', 'lost')
    AND t.received_at IS NULL
    AND t.due_date IS NOT NULL
    AND t.due_date <= p_today + p_horizon_days
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
  LEFT JOIN contacts c ON c.id = d.contact_id AND c.account_id = p_account_id
  LEFT JOIN properties p ON p.id = d.property_id AND p.account_id = p_account_id
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
