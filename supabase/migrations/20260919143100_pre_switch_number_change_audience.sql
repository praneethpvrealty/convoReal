CREATE FUNCTION public.whatsapp_number_change_audience_v2(
  p_account_id UUID,
  p_since TIMESTAMPTZ,
  p_phone_number_id TEXT,
  p_changed_at TIMESTAMPTZ
)
RETURNS TABLE (
  contact_id UUID,
  name TEXT,
  preferred_language TEXT,
  last_message_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    c.id,
    c.name,
    c.preferred_language,
    MAX(cv.last_message_at)
  FROM public.contacts c
  JOIN public.conversations cv
    ON cv.contact_id = c.id
   AND cv.account_id = c.account_id
  WHERE c.account_id = p_account_id
    AND public.is_account_member(p_account_id)
    AND cv.last_message_at >= p_since
    AND EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.conversation_id = cv.id
        AND m.created_at < p_changed_at
    )
    AND c.phone IS NOT NULL
    AND COALESCE(c.is_dead, false) = false
    AND COALESCE(c.is_archived, false) = false
    AND COALESCE(c.chain_only, false) = false
    AND COALESCE(c.is_merged, false) = false
    AND NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_number_change_notices n
      WHERE n.account_id = c.account_id
        AND n.contact_id = c.id
        AND n.phone_number_id = p_phone_number_id
    )
  GROUP BY c.id, c.name, c.preferred_language
  ORDER BY MAX(cv.last_message_at) DESC
  LIMIT 500;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_number_change_audience_v2(UUID, TIMESTAMPTZ, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_number_change_audience_v2(UUID, TIMESTAMPTZ, TEXT, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_number_change_audience_v2(UUID, TIMESTAMPTZ, TEXT, TIMESTAMPTZ) TO authenticated;
