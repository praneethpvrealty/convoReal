CREATE INDEX IF NOT EXISTS idx_messages_content_text_trgm
  ON public.messages
  USING gin (content_text extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL;

DROP FUNCTION IF EXISTS public.search_inbox_messages(UUID, TEXT, INT);

CREATE OR REPLACE FUNCTION public.search_inbox_messages(
  p_account_id UUID,
  p_query TEXT,
  p_archived BOOLEAN DEFAULT FALSE,
  p_limit INT DEFAULT 1000
)
RETURNS TABLE (
  conversation_id UUID,
  message_id UUID,
  content_text TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  WITH q AS (
    SELECT '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pattern
    WHERE char_length(btrim(coalesce(p_query, ''))) >= 2
  ),
  hits AS (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id, m.id, m.content_text, m.created_at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    CROSS JOIN q
    WHERE m.account_id = p_account_id
      AND c.account_id = p_account_id
      AND c.is_archived = coalesce(p_archived, FALSE)
      AND c.last_message_at IS NOT NULL
      AND m.deleted_at IS NULL
      AND m.content_text ILIKE q.pattern
    ORDER BY m.conversation_id, m.created_at DESC
  )
  SELECT h.conversation_id, h.id, h.content_text, h.created_at
  FROM hits h
  ORDER BY h.created_at DESC
  LIMIT least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;

REVOKE ALL ON FUNCTION public.search_inbox_messages(UUID, TEXT, BOOLEAN, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_inbox_messages(UUID, TEXT, BOOLEAN, INT) TO authenticated;
