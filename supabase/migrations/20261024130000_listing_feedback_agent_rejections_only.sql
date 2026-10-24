-- ============================================================
-- 20261024130000_listing_feedback_agent_rejections_only.sql
--
-- Two follow-ups to the agent "Not a fit" marks.
--
-- 1. A staff write may only record a rejection. The feature never
--    writes anything else, and an agent 'interested' row would be read
--    as the contact's own interest when type suggestions are worked
--    out.
--
-- 2. The source-stamping trigger stops guessing at the reason. It used
--    to clear the reason when a buyer's write took over an agent mark
--    with an unchanged reason, which also wiped a buyer who happened to
--    give the agent's reason. Buyer-side writers that carry no reason
--    now send reason = NULL themselves, so the trigger only stamps who
--    said it.
--
-- Touches only the policies and the trigger function this feature
-- added; no deployed code writes agent rows yet.
-- ============================================================

ALTER POLICY listing_feedback_agent_insert ON listing_feedback
  WITH CHECK (
    source = 'agent'
    AND verdict = 'rejected'
    AND created_by = auth.uid()
    AND is_account_writer(account_id, 'agent')
    AND EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = contact_id AND c.account_id = listing_feedback.account_id
    )
    AND EXISTS (
      SELECT 1 FROM properties p
      WHERE p.id = property_id AND p.account_id = listing_feedback.account_id
    )
  );

ALTER POLICY listing_feedback_agent_update ON listing_feedback
  WITH CHECK (
    source = 'agent'
    AND verdict = 'rejected'
    AND created_by = auth.uid()
    AND is_account_writer(account_id, 'agent')
    AND EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = contact_id AND c.account_id = listing_feedback.account_id
    )
    AND EXISTS (
      SELECT 1 FROM properties p
      WHERE p.id = property_id AND p.account_id = listing_feedback.account_id
    )
  );

CREATE OR REPLACE FUNCTION public.listing_feedback_stamp_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    NEW.source := 'contact';
    NEW.created_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;
