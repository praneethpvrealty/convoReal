-- ============================================================
-- 20261024120000_listing_feedback_agent_rows_only.sql
--
-- Staff change only their own kind of row. The agent update and delete
-- policies from 20261024090000 let a member's JWT rewrite or remove a
-- row the buyer wrote: an agent "Not a fit" could turn the buyer's own
-- "no" into an agent mark (reopening notices for a closed enquiry), or
-- replace and then delete their "interested". A staff write may now
-- touch a row only while it is an agent mark; the buyer's answers stay
-- with the service-role writers that record them.
-- ============================================================

ALTER POLICY listing_feedback_agent_update ON listing_feedback
  USING (source = 'agent' AND is_account_writer(account_id, 'agent'));

ALTER POLICY listing_feedback_agent_delete ON listing_feedback
  USING (source = 'agent' AND is_account_writer(account_id, 'agent'));
