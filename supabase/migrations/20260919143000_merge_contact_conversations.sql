-- Preserve both WhatsApp histories when two contact records are merged.
-- The contacts endpoint calls this through its service-role client after
-- verifying account membership and before hiding the source contact.

CREATE OR REPLACE FUNCTION public.merge_contact_conversations(
  p_account_id UUID,
  p_source_contact_id UUID,
  p_target_contact_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_source conversations%ROWTYPE;
  v_target conversations%ROWTYPE;
  v_latest messages%ROWTYPE;
  v_last_customer_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_source
  FROM conversations
  WHERE account_id = p_account_id
    AND contact_id = p_source_contact_id
  FOR UPDATE;

  SELECT * INTO v_target
  FROM conversations
  WHERE account_id = p_account_id
    AND contact_id = p_target_contact_id
  FOR UPDATE;

  IF v_source.id IS NULL THEN
    RETURN v_target.id;
  END IF;

  IF v_target.id IS NULL THEN
    UPDATE conversations
    SET contact_id = p_target_contact_id,
        updated_at = NOW()
    WHERE id = v_source.id;
    RETURN v_source.id;
  END IF;

  UPDATE messages
  SET conversation_id = v_target.id
  WHERE conversation_id = v_source.id;

  UPDATE message_reactions
  SET conversation_id = v_target.id
  WHERE conversation_id = v_source.id;

  UPDATE deals
  SET conversation_id = v_target.id
  WHERE conversation_id = v_source.id;

  UPDATE flow_runs
  SET conversation_id = v_target.id
  WHERE conversation_id = v_source.id;

  UPDATE ctwa_referrals
  SET conversation_id = v_target.id
  WHERE conversation_id = v_source.id;

  UPDATE learned_facts
  SET conversation_id = v_target.id
  WHERE conversation_id = v_source.id;

  UPDATE whatsapp_reply_bridges
  SET target_conversation_id = v_target.id,
      target_contact_id = p_target_contact_id
  WHERE target_conversation_id = v_source.id;

  UPDATE pending_map_pins
  SET conversation_id = v_target.id
  WHERE conversation_id = v_source.id;

  UPDATE pending_client_replies
  SET conversation_id = v_target.id
  WHERE conversation_id = v_source.id;

  SELECT * INTO v_latest
  FROM messages
  WHERE conversation_id = v_target.id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  SELECT MAX(created_at) INTO v_last_customer_at
  FROM messages
  WHERE conversation_id = v_target.id
    AND sender_type = 'customer';

  UPDATE conversations
  SET status = CASE
        WHEN v_target.status = 'closed' AND v_source.status = 'closed' THEN 'closed'
        WHEN v_target.status = 'open' OR v_source.status = 'open' THEN 'open'
        ELSE 'pending'
      END,
      is_archived = v_target.is_archived AND v_source.is_archived,
      unread_count = COALESCE(v_target.unread_count, 0) + COALESCE(v_source.unread_count, 0),
      assigned_agent_id = COALESCE(v_target.assigned_agent_id, v_source.assigned_agent_id),
      last_message_at = COALESCE(v_latest.created_at, v_target.last_message_at, v_source.last_message_at),
      last_message_text = COALESCE(v_latest.content_text, v_target.last_message_text, v_source.last_message_text),
      last_customer_message_at = v_last_customer_at,
      awaiting_reply = (
        v_latest.sender_type = 'customer'
        AND NOT (v_target.status = 'closed' AND v_source.status = 'closed')
        AND NOT (v_target.is_archived AND v_source.is_archived)
      ),
      updated_at = NOW()
  WHERE id = v_target.id;

  DELETE FROM conversations WHERE id = v_source.id;

  RETURN v_target.id;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_contact_conversations(UUID, UUID, UUID)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_contact_conversations(UUID, UUID, UUID)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_contact_conversations(UUID, UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION public.merge_contact_conversations(UUID, UUID, UUID) IS
  'Combines both one-to-one WhatsApp histories before a duplicate contact is hidden.';
