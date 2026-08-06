-- ============================================================
-- Let an agent delete the contacts they saved themselves.
--
-- Migration 082 narrowed contacts_delete to org_manager only. That
-- left an agent unable to remove a row they had just created — a
-- typo, a duplicate, a test contact — without asking a manager, while
-- still being able to edit every field on it.
--
-- Managers keep blanket delete across the account. Everyone else may
-- delete only rows they own (contacts.user_id = auth.uid()).
--
-- Read-only members are excluded: migration 082 folds the old
-- 'viewer' account_role into org_agent + is_read_only = TRUE, so the
-- org_role alone no longer distinguishes them.
--
-- Deleting stays safe for history: migration 004 moved
-- broadcast_recipients.contact_id and deals.contact_id to
-- ON DELETE SET NULL, so those rows survive a delete.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

DROP POLICY IF EXISTS contacts_delete ON contacts;

CREATE POLICY contacts_delete ON contacts FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = contacts.account_id
      AND p.is_read_only IS NOT TRUE
      AND (p.org_role = 'org_manager' OR contacts.user_id = auth.uid())
  )
);
