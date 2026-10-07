-- ============================================================
-- record_enquiry_budget: write an enquiry-seeded budget and its anchor
-- in one transaction.
--
-- The lead webhook used to write contacts.pref_budget_max and then
-- contacts.pref_budget_anchor in two requests. Two portal emails for
-- the same contact could interleave them and leave one enquiry's budget
-- with the other's anchor, and a failed second request left the budget
-- unanchored. This function locks the row, decides from its current
-- state whether the lead had already stated a budget (a budget with no
-- anchor), writes the budget, and anchors it only when it was not
-- stated. The budget write fires contacts_clear_stale_budget_anchor;
-- the anchor is written by a second statement that trigger does not see.
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_enquiry_budget(
  p_account_id UUID,
  p_contact_id UUID,
  p_budget NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_stated BOOLEAN;
BEGIN
  SELECT pref_budget_max IS NOT NULL AND pref_budget_anchor IS NULL
    INTO v_stated
    FROM contacts
   WHERE id = p_contact_id
     AND account_id = p_account_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE contacts
     SET pref_budget_max = p_budget
   WHERE id = p_contact_id
     AND account_id = p_account_id;

  IF NOT v_stated THEN
    UPDATE contacts
       SET pref_budget_anchor = p_budget
     WHERE id = p_contact_id
       AND account_id = p_account_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_enquiry_budget(UUID, UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_enquiry_budget(UUID, UUID, NUMERIC)
  TO service_role;
