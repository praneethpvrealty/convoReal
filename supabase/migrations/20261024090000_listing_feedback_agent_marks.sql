-- ============================================================
-- 20261024090000_listing_feedback_agent_marks.sql
--
-- "Not a fit" from the agent. Until now listing_feedback held only a
-- contact's own verdict, written by the WhatsApp feedback prompt with
-- the service role. An agent reviewing a listing's Matching Contacts
-- list can now mark a matched contact as not a fit, with the same
-- one-tap reasons, so the list stops offering them for that listing and
-- Match Radar stops re-offering it to them.
--
-- source tells the two apart: 'contact' for the buyer's own answer
-- (every existing row), 'agent' for a staff mark. created_by names the
-- member who made a staff mark.
--
-- Staff write through their own JWT, so the write policies use
-- is_account_writer(): a read-only member can read the marks and never
-- make one. Additive only: two new columns and three new policies.
-- ============================================================

ALTER TABLE listing_feedback
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'contact'
    CHECK (source IN ('contact', 'agent')),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_listing_feedback_property_account
  ON listing_feedback (account_id, property_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'listing_feedback'
      AND policyname = 'listing_feedback_agent_insert'
  ) THEN
    CREATE POLICY listing_feedback_agent_insert ON listing_feedback
      FOR INSERT WITH CHECK (
        source = 'agent' AND is_account_writer(account_id, 'agent')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'listing_feedback'
      AND policyname = 'listing_feedback_agent_update'
  ) THEN
    CREATE POLICY listing_feedback_agent_update ON listing_feedback
      FOR UPDATE USING (is_account_writer(account_id, 'agent'))
      WITH CHECK (
        source = 'agent' AND is_account_writer(account_id, 'agent')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'listing_feedback'
      AND policyname = 'listing_feedback_agent_delete'
  ) THEN
    CREATE POLICY listing_feedback_agent_delete ON listing_feedback
      FOR DELETE USING (is_account_writer(account_id, 'agent'));
  END IF;
END $$;

COMMENT ON COLUMN listing_feedback.source IS
  'contact = the buyer''s own verdict (WhatsApp prompt); agent = a staff "Not a fit" mark from the Matching Contacts list';
COMMENT ON COLUMN listing_feedback.created_by IS
  'The member who made an agent mark; NULL for the contact''s own verdict';
