-- A claim's send may be confirmed late — the confirmation rode the
-- queue through an outage — after the cron has already taken the claim
-- over and sent again, possibly more than once. The unique
-- (appointment, recipient, type) key leaves one row for every send, so
-- each earlier message id is kept beside the current one and the reply
-- webhook matches a button tap by any of them
-- (src/lib/appointments/claim-confirm.ts,
-- src/lib/whatsapp/webhook-handler.ts). The append is a function so
-- two late confirmations cannot lose each other's id.

ALTER TABLE appointment_reminder_log
  ADD COLUMN IF NOT EXISTS prior_wa_message_ids TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_appointment_reminder_log_prior_wa_message_ids
  ON appointment_reminder_log USING GIN (prior_wa_message_ids);

COMMENT ON COLUMN appointment_reminder_log.prior_wa_message_ids IS
  'Message ids of earlier sends of this claim whose confirmations arrived after the cron had taken the claim over; a button reply to any of them still maps to the appointment.';

CREATE OR REPLACE FUNCTION public.appointment_reminder_keep_prior_id(
  p_account_id UUID,
  p_claim_id UUID,
  p_appointment_id UUID,
  p_contact_id UUID,
  p_liaison_id UUID,
  p_reminder_type TEXT,
  p_wa_message_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_claim_id IS NOT NULL THEN
    UPDATE appointment_reminder_log
       SET prior_wa_message_ids = array_append(prior_wa_message_ids, p_wa_message_id)
     WHERE account_id = p_account_id
       AND id = p_claim_id
       AND NOT (p_wa_message_id = ANY (prior_wa_message_ids));
    IF FOUND THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM appointment_reminder_log
       WHERE account_id = p_account_id AND id = p_claim_id
    );
  END IF;

  UPDATE appointment_reminder_log
     SET prior_wa_message_ids = array_append(prior_wa_message_ids, p_wa_message_id)
   WHERE account_id = p_account_id
     AND appointment_id = p_appointment_id
     AND reminder_type = p_reminder_type
     AND ((p_liaison_id IS NOT NULL AND liaison_id = p_liaison_id)
       OR (p_liaison_id IS NULL AND contact_id = p_contact_id))
     AND NOT (p_wa_message_id = ANY (prior_wa_message_ids));
  IF FOUND THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM appointment_reminder_log
     WHERE account_id = p_account_id
       AND appointment_id = p_appointment_id
       AND reminder_type = p_reminder_type
       AND ((p_liaison_id IS NOT NULL AND liaison_id = p_liaison_id)
         OR (p_liaison_id IS NULL AND contact_id = p_contact_id))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.appointment_reminder_keep_prior_id(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.appointment_reminder_keep_prior_id(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT) TO service_role;
