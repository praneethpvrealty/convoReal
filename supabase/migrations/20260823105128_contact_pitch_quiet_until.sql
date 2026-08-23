-- ============================================================
-- contacts.pitch_quiet_until — the date a client asked to be left until.
--
-- A buyer answered a journey check-in with "By the 5th of September"
-- and was pitched a new listing fourteen seconds later. Asking someone
-- when to come back and then not waiting is worse than never asking:
-- it tells them the question was a formality.
--
-- Only UNPROMPTED new-listing pitches respect this. Alerts a contact
-- explicitly opted into keep flowing — they asked for those — and so
-- does every reply to something the contact just sent. A quiet window
-- is not a mute.
--
-- Null means no commitment on file, which is the normal state.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS pitch_quiet_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contacts_pitch_quiet_until
  ON contacts (account_id, pitch_quiet_until)
  WHERE pitch_quiet_until IS NOT NULL;
