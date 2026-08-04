-- ============================================================
-- Park a client's requirement without deleting it.
--
-- A brief that is met, withdrawn or on hold should stop being offered
-- to co-brokers, but the text is still the record of what they wanted
-- and is the source AI preference extraction reads. Deleting it loses
-- both, so it is parked instead.
--
-- Scope is deliberately sharing: src/lib/requirements/share.ts drops
-- parked rows from anything sent outward. Matching, Match Radar and
-- the buyer digest are untouched — a parked requirement still matches
-- internally, which is what an agent expects while they wait to hear
-- back from the client.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS requirement_active BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN contacts.requirement_active IS
  'False parks this contact''s requirement: it is excluded from co-broker sharing (src/lib/requirements/share.ts). Does not affect matching or digests.';
