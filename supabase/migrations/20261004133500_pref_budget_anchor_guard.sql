-- ============================================================
-- Keep contacts.pref_budget_anchor (migration 20261004131500) true.
--
-- The anchor marks a pref_budget_max the portal lead webhook seeded
-- from an enquired listing's price. Any other writer that changes
-- pref_budget_max — the WhatsApp ladder, a budget-band tap, a flow, an
-- agent editing the contact — is stating a budget, so the anchor no
-- longer describes it. Clearing it here, rather than in each writer,
-- means a maximum edited away and later back to the enquiry price is
-- not mistaken for the enquiry's floorless ceiling. The webhook writes
-- the anchor in the same update as the budget, which this leaves alone.
-- ============================================================

CREATE OR REPLACE FUNCTION public.contacts_clear_stale_budget_anchor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.pref_budget_anchor IS NOT NULL
     AND NEW.pref_budget_max IS DISTINCT FROM OLD.pref_budget_max
     AND NEW.pref_budget_anchor IS NOT DISTINCT FROM OLD.pref_budget_anchor THEN
    NEW.pref_budget_anchor := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_clear_stale_budget_anchor ON public.contacts;
CREATE TRIGGER contacts_clear_stale_budget_anchor
  BEFORE UPDATE OF pref_budget_max ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.contacts_clear_stale_budget_anchor();
