-- ============================================================
-- Parking now stops matching, not only sharing.
--
-- 194 scoped requirement_active to co-broker shares, on the reasoning
-- that a quiet client still wants to hear about the right listing. In
-- practice "turn this requirement off" means off: a parked brief was
-- still generating Radar events and buyer digests for a client the
-- agent had already marked dormant.
--
-- getMatchingContacts() now skips a parked contact ahead of every other
-- gate, so Match Radar, the buyer portal feed, the buyer match digest,
-- the Portfolio deal-mode sweep and the share dialog all inherit it.
-- Comment-only migration; the column and its default are unchanged.
-- ============================================================

COMMENT ON COLUMN contacts.requirement_active IS
  'False parks this contact''s requirement: src/lib/matching.ts skips them entirely, so they reach no match, Radar event, digest or co-broker share. The requirement text is kept as the record and as AI preference extraction''s source.';
