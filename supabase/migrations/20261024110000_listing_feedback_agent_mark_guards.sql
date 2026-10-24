-- ============================================================
-- 20261024110000_listing_feedback_agent_mark_guards.sql
--
-- Two guards on the agent "Not a fit" marks added by
-- 20261024090000_listing_feedback_agent_marks.sql.
--
-- 1. A staff write may only name its own account's contact and
--    listing, and only in its own name. Without this, a writer could
--    insert a row for another tenant's (contact, property) pair, which
--    UNIQUE(contact_id, property_id) would then hold against that
--    tenant's own marks.
--
-- 2. Every service-role write is the buyer's own answer (the WhatsApp
--    feedback prompt, enquiry close, disinterest, view check-in, email
--    interest), and none of those writers names a source. A buyer who
--    answers after an agent marked them would otherwise keep the
--    agent's attribution. A write with no signed-in member is stamped
--    as the contact's, and when it takes over an agent mark without
--    giving a reason of its own, the agent's reason is dropped.
--
-- Both touch only what that migration created: its policies, and its
-- two columns through a new trigger.
-- ============================================================

ALTER POLICY listing_feedback_agent_insert ON listing_feedback
  WITH CHECK (
    source = 'agent'
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
    IF TG_OP = 'UPDATE'
       AND OLD.source = 'agent'
       AND NEW.reason IS NOT DISTINCT FROM OLD.reason THEN
      NEW.reason := NULL;
    END IF;
    NEW.source := 'contact';
    NEW.created_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'listing_feedback_stamp_source'
      AND tgrelid = 'public.listing_feedback'::regclass
  ) THEN
    CREATE TRIGGER listing_feedback_stamp_source
      BEFORE INSERT OR UPDATE ON listing_feedback
      FOR EACH ROW EXECUTE FUNCTION public.listing_feedback_stamp_source();
  END IF;
END $$;
