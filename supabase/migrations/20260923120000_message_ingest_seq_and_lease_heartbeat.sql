SET lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS public.messages_ingest_seq AS BIGINT;

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS ingest_seq BIGINT;

ALTER TABLE public.messages
  ALTER COLUMN ingest_seq SET DEFAULT nextval('public.messages_ingest_seq');

ALTER SEQUENCE public.messages_ingest_seq OWNED BY public.messages.ingest_seq;

GRANT USAGE, SELECT ON SEQUENCE public.messages_ingest_seq TO anon, authenticated, service_role;

ALTER TABLE public.conversation_qualification_leases
  ADD COLUMN IF NOT EXISTS pending_message_ids TEXT[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.renew_conversation_qualification_lease(
  p_conversation_id UUID,
  p_holder UUID,
  p_ttl_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE conversation_qualification_leases
     SET expires_at = NOW() + make_interval(secs => p_ttl_seconds)
   WHERE conversation_id = p_conversation_id
     AND holder = p_holder;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.defer_conversation_qualification(
  p_conversation_id UUID,
  p_message_id TEXT
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
     AND expires_at > NOW();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_conversation_qualification_lease(
  p_conversation_id UUID,
  p_holder UUID,
  p_ttl_seconds INTEGER
)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pending TEXT[];
BEGIN
  SELECT pending_message_ids INTO pending
    FROM conversation_qualification_leases
   WHERE conversation_id = p_conversation_id
     AND holder = p_holder
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN '{}';
  END IF;
  IF cardinality(pending) > 0 THEN
    UPDATE conversation_qualification_leases
       SET pending_message_ids = '{}',
           expires_at = NOW() + make_interval(secs => p_ttl_seconds)
     WHERE conversation_id = p_conversation_id
       AND holder = p_holder;
    RETURN pending;
  END IF;
  DELETE FROM conversation_qualification_leases
   WHERE conversation_id = p_conversation_id
     AND holder = p_holder;
  RETURN '{}';
END;
$$;

REVOKE ALL ON FUNCTION public.renew_conversation_qualification_lease(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_conversation_qualification_lease(UUID, UUID, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_conversation_qualification_lease(UUID, UUID, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.defer_conversation_qualification(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.defer_conversation_qualification(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.defer_conversation_qualification(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.finish_conversation_qualification_lease(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_conversation_qualification_lease(UUID, UUID, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_conversation_qualification_lease(UUID, UUID, INTEGER) TO service_role;
