-- ============================================================
-- Clear contacts.pref_budget_anchor on every write of pref_budget_max.
--
-- 20261004133500_pref_budget_anchor_guard cleared the anchor only when
-- the budget changed. A buyer who confirms the enquiry's own figure
-- through a flow or a budget-band tap writes the same value, and the
-- anchor survived it, so a stated budget kept reading as the enquiry's
-- floorless ceiling. A BEFORE UPDATE OF trigger fires whenever the
-- column is written, changed or not, so any write now clears it. The
-- lead webhook sets the anchor in an update of its own after writing
-- the budget, which this trigger does not see.
-- ============================================================

CREATE OR REPLACE FUNCTION public.contacts_clear_stale_budget_anchor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.pref_budget_anchor := NULL;
  RETURN NEW;
END;
$$;
