-- ============================================================
-- 20261019140000_showcase_share_link_pinned_ids.sql
--
-- A search-results or hand-picked showcase share used to spell every
-- listing it opened into the link (?ids=PROP-1,PROP-2,…), so a search
-- matching sixty listings went out as a sixty-code URL that swamped
-- the message. The share instance the link already carries (?s=,
-- migration 173) now records the pinned listings, and the link carries
-- the token alone. Rows are written once and never updated, so a link
-- that was copied keeps opening what it opened.
-- ============================================================

ALTER TABLE showcase_share_links
  ADD COLUMN IF NOT EXISTS pinned_ids TEXT[];

COMMENT ON COLUMN showcase_share_links.pinned_ids IS
  'property_code (or id) per listing the share opens, in display order; NULL opens the whole catalogue';
