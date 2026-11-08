-- System-authored contact notes.
--
-- Every note the Engine writes on a lead's own action carries no author:
-- the close that marks a lead dead, START ALERTS reviving them, the
-- drop-off reason, the enquiry review and the portal re-enquiry revival
-- (INB-049) all insert user_id = NULL. The column has been NOT NULL
-- since 001, so each of those inserts has failed and the audit trail
-- those modules promise never landed. Reads are already account-scoped
-- (017: contact_notes_select on is_account_member), so a note without
-- an author is visible to the account like any other.

ALTER TABLE contact_notes ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN contact_notes.user_id IS
  'Author of the note; NULL for a note the Engine wrote on the lead''s own action (close, START ALERTS, drop-off reason, portal re-enquiry).';
