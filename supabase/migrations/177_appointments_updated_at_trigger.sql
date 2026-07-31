-- appointments never got the set_updated_at trigger every other
-- operational table has, and each path that closes an event writes
-- `status` on its own: the Today list, the calendar's complete toggle,
-- the mobile detail sheet. updated_at therefore still held the row's
-- creation time on every appointment in the table — including ones
-- sitting at status 'completed' — so "this was closed before its
-- reminder fired" had nothing to check it against.

DROP TRIGGER IF EXISTS set_appointments_updated_at ON appointments;

CREATE TRIGGER set_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
