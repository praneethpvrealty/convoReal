CREATE OR REPLACE FUNCTION conversation_last_message_statuses(
  p_conversation_ids UUID[]
)
RETURNS TABLE (conversation_id UUID, sender_type TEXT, status TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.id, m.sender_type::TEXT, m.status::TEXT
  FROM unnest(p_conversation_ids[1:200]) AS c(id)
  CROSS JOIN LATERAL (
    SELECT sender_type, status
    FROM messages
    WHERE messages.conversation_id = c.id
    ORDER BY created_at DESC
    LIMIT 1
  ) m;
$$;

COMMENT ON FUNCTION conversation_last_message_statuses(UUID[]) IS
  'Latest message sender and delivery status for up to 200 conversations in one call, for the inbox delivery ticks. SECURITY INVOKER: the messages SELECT policy decides which conversations the caller can read, so a conversation outside their reach returns no row.';

REVOKE ALL ON FUNCTION conversation_last_message_statuses(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION conversation_last_message_statuses(UUID[]) TO authenticated, service_role;
