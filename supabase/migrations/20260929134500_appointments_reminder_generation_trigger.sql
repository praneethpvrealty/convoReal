-- The reminder generation rule, applied to every writer at once.
-- PUT /api/appointments/[id] stamps reminders_rearmed_at and sets the
-- sent flags when an appointment is moved, reopened or closed, but the
-- WhatsApp scheduler, the Today page and any future writer update the
-- row directly. This trigger makes the same decision on the row itself,
-- so no path can move or close an appointment and leave a reminder
-- fetched, queued or mid-send for its earlier state deliverable, or
-- reuse a claim confirmed for a time it no longer has.
--
-- Not additive: it changes what an existing UPDATE does. Apply with
-- the merge to main.

CREATE OR REPLACE FUNCTION public.appointments_reminder_generation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  moved BOOLEAN := NEW.start_time IS DISTINCT FROM OLD.start_time;
  reopened BOOLEAN := NEW.status = 'scheduled' AND OLD.status IS DISTINCT FROM 'scheduled';
  closed BOOLEAN := OLD.status = 'scheduled' AND NEW.status IS DISTINCT FROM 'scheduled';
BEGIN
  IF NOT (moved OR reopened OR closed) THEN
    RETURN NEW;
  END IF;

  NEW.reminders_rearmed_at := now();

  IF moved THEN
    NEW.reschedule_requested_at := NULL;
    NEW.client_confirmed_at := NULL;
  END IF;

  IF moved OR reopened THEN
    IF NEW.start_time > now() THEN
      NEW.reminder_morning_sent := false;
      NEW.reminder_1h_sent := false;
    ELSE
      NEW.reminder_morning_sent := true;
      NEW.reminder_1h_sent := true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appointments_reminder_generation ON appointments;
CREATE TRIGGER trg_appointments_reminder_generation
  BEFORE UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.appointments_reminder_generation();

COMMENT ON FUNCTION public.appointments_reminder_generation() IS
  'Stamps a new reminder generation, and resets or covers the sent flags, whenever an appointment is moved, reopened or closed — whichever code path wrote it.';
