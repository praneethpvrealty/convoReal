-- Replaces appointment_reminder_hand_back from 20260929113500 with the
-- guarded body: a note queued before claims were recorded (no claim
-- id) releases only a claim that is itself from before then — no
-- generation, no confirmed send — so a claim a later sweep renewed or
-- delivered is never taken with it; and the flag re-opens only when a
-- claim was in fact released. Depends on 20260929120000 (sent_at).
-- Replacing an existing function is not additive: apply with the
-- merge to main.

CREATE OR REPLACE FUNCTION public.appointment_reminder_hand_back(
  p_account_id UUID,
  p_appointment_id UUID,
  p_contact_id UUID,
  p_reminder_type TEXT,
  p_claim_id UUID,
  p_claimed_at TIMESTAMPTZ,
  p_rearmed_known BOOLEAN,
  p_rearmed_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_claim_id IS NULL THEN
    -- A note queued before claims were recorded: only a claim that is
    -- itself from before then (no generation, no confirmed send) is
    -- its own; a renewed or delivered claim belongs to a later sweep.
    DELETE FROM appointment_reminder_log
     WHERE account_id = p_account_id
       AND appointment_id = p_appointment_id
       AND contact_id = p_contact_id
       AND reminder_type = p_reminder_type
       AND rearmed_at IS NULL
       AND sent_at IS NULL;
  ELSE
    DELETE FROM appointment_reminder_log
     WHERE account_id = p_account_id
       AND id = p_claim_id
       AND (p_claimed_at IS NULL OR created_at = p_claimed_at);
  END IF;

  -- The flag re-opens only for the claim just released: when the
  -- claim was already someone else's, so is the reminder.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE appointments
     SET reminder_1h_sent = CASE WHEN p_reminder_type = '1h' THEN false ELSE reminder_1h_sent END,
         reminder_morning_sent = CASE WHEN p_reminder_type = 'morning' THEN false ELSE reminder_morning_sent END
   WHERE account_id = p_account_id
     AND id = p_appointment_id
     AND (NOT p_rearmed_known OR reminders_rearmed_at IS NOT DISTINCT FROM p_rearmed_at);
END;
$$;

REVOKE ALL ON FUNCTION public.appointment_reminder_hand_back(UUID, UUID, UUID, TEXT, UUID, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.appointment_reminder_hand_back(UUID, UUID, UUID, TEXT, UUID, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ) TO service_role;
