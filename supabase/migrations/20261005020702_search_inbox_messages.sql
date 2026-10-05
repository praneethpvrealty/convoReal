CREATE INDEX IF NOT EXISTS idx_messages_content_text_trgm
  ON public.messages
  USING gin (content_text extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.search_inbox_messages(
  p_account_id UUID,
  p_query TEXT,
  p_limit INT DEFAULT 100
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
    FROM public.messages m, q
    WHERE m.account_id = p_account_id
      AND m.deleted_at IS NULL
      AND m.content_text ILIKE q.pattern
    ORDER BY m.conversation_id, m.created_at DESC
  )
  SELECT h.conversation_id, h.id, h.content_text, h.created_at
  FROM hits h
  ORDER BY h.created_at DESC
  LIMIT least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

REVOKE ALL ON FUNCTION public.search_inbox_messages(UUID, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_inbox_messages(UUID, TEXT, INT) TO authenticated;
