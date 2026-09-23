CREATE TABLE IF NOT EXISTS public.conversation_deferred_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (conversation_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_deferred_messages_account
  ON public.conversation_deferred_messages (account_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.conversation_deferred_messages;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.conversation_deferred_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.conversation_deferred_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.conversation_deferred_messages FROM anon, authenticated;
GRANT SELECT ON TABLE public.conversation_deferred_messages TO authenticated;

DROP POLICY IF EXISTS conversation_deferred_messages_select ON public.conversation_deferred_messages;
CREATE POLICY conversation_deferred_messages_select
  ON public.conversation_deferred_messages FOR SELECT
  TO authenticated
  USING (is_account_member(account_id));

CREATE OR REPLACE FUNCTION public.defer_conversation_message(
  p_account_id UUID,
  p_conversation_id UUID,
  p_message_id TEXT,
  p_payload JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE conversation_qualification_leases
     SET pending_message_ids = CASE
           WHEN p_message_id = ANY (pending_message_ids) THEN pending_message_ids
           ELSE array_append(pending_message_ids, p_message_id)
         END
   WHERE conversation_id = p_conversation_id
     AND account_id = p_account_id
     AND expires_at > NOW();
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  INSERT INTO conversation_deferred_messages (account_id, conversation_id, message_id, payload)
  VALUES (p_account_id, p_conversation_id, p_message_id, p_payload)
  ON CONFLICT (conversation_id, message_id) DO UPDATE
    SET payload = EXCLUDED.payload;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.defer_conversation_message(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.defer_conversation_message(UUID, UUID, TEXT, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.defer_conversation_message(UUID, UUID, TEXT, JSONB) TO service_role;
