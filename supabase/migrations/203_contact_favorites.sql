-- ============================================================
-- Contact favourites — agents star contacts they are actively
-- working; the starred set surfaces as a "Favourites" quick-filter
-- tab on the Contacts page (web) and segment (mobile), sitting
-- next to "Needs Review".
--
-- Unlike properties.is_starred (capped at 6 because each star
-- renders a chip), this is an uncapped bookmark: the tab is a
-- paged list, so a large favourite set costs nothing to display.
--
-- The tab deliberately spans every status. A contact parked in
-- pending_review is exactly the kind an agent stars to come back
-- to, so scoping the filter to status='active' would hide the
-- ones the feature exists for.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_contacts_favorite
  ON contacts(account_id) WHERE is_favorite = true;

COMMENT ON COLUMN contacts.is_favorite IS
  'Account-wide star: surfaces this contact under the Favourites tab on the Contacts page. Uncapped, and spans every contact status.';
