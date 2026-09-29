-- Hands a client reminder back to the cron in one transaction: the
-- voice-note worker releases the delivery claim it holds and re-opens
-- the appointment's sent flag together, so a failure between the two
-- can never leave the flag saying "sent" with no claim, or a claim with
-- no flag to retry. The flag is re-opened only for the generation the
-- note was rendered from (src/lib/voice/reminder-audio-worker.ts).

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
    DELETE FROM appointment_reminder_log
     WHERE account_id = p_account_id
       AND appointment_id = p_appointment_id
       AND contact_id = p_contact_id
       AND reminder_type = p_reminder_type;
  ELSE
    DELETE FROM appointment_reminder_log
     WHERE account_id = p_account_id
       AND id = p_claim_id
       AND (p_claimed_at IS NULL OR created_at = p_claimed_at);
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
