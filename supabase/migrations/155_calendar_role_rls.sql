-- Tighten RLS on todos & appointments to be role-aware.
--
-- Migration 027 created a single `FOR ALL USING (profiles.account_id = ...)`
-- policy on each table — membership only, no minimum role. That let a
-- read-only `viewer` UPDATE/DELETE todos and reschedule/delete
-- appointments (the API routes now also enforce 'agent', this closes the
-- DB layer so it no longer depends on the app layer alone).
--
-- Reads stay open to every account member; writes require 'agent'+.

DROP POLICY IF EXISTS "Users can manage own account appointments" ON appointments;
DROP POLICY IF EXISTS "Users can manage own account todos" ON todos;

CREATE POLICY appointments_select ON appointments
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY appointments_insert ON appointments
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY appointments_update ON appointments
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY appointments_delete ON appointments
  FOR DELETE USING (is_account_member(account_id, 'agent'));

CREATE POLICY todos_select ON todos
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY todos_insert ON todos
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY todos_update ON todos
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY todos_delete ON todos
  FOR DELETE USING (is_account_member(account_id, 'agent'));
