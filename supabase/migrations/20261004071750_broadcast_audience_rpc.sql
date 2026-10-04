-- 20261004071750_broadcast_audience_rpc.sql
-- Broadcast recipients decided in one place, counted in SQL, and CSV
-- numbers matched against the normalised stored phone.

CREATE OR REPLACE FUNCTION public.broadcast_audience_contact_ids(
  p_account_id UUID,
  p_type TEXT,
  p_tag_ids UUID[] DEFAULT NULL,
  p_contact_ids UUID[] DEFAULT NULL,
  p_field_id UUID DEFAULT NULL,
  p_field_operator TEXT DEFAULT NULL,
  p_field_value TEXT DEFAULT NULL,
  p_exclude_tag_ids UUID[] DEFAULT NULL,
  p_opted_in_only BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (contact_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM contacts c
  WHERE c.account_id = p_account_id
    AND is_account_member(p_account_id, 'agent')
    AND c.phone ~ '\S'
    AND c.buyer_alerts_consent <> 'declined'
    AND NOT c.chain_only
    AND NOT c.is_dead
    AND NOT c.is_archived
    AND (NOT COALESCE(p_opted_in_only, FALSE) OR c.buyer_alerts_consent = 'granted')
    AND CASE p_type
      WHEN 'all' THEN TRUE
      WHEN 'contacts' THEN c.id = ANY (p_contact_ids)
      WHEN 'tags' THEN EXISTS (
        SELECT 1 FROM contact_tags ct
        WHERE ct.contact_id = c.id
          AND ct.tag_id = ANY (p_tag_ids)
      )
      WHEN 'custom_field' THEN EXISTS (
        SELECT 1 FROM contact_custom_values v
        WHERE v.contact_id = c.id
          AND v.custom_field_id = p_field_id
          AND CASE p_field_operator
            WHEN 'is' THEN v.value = p_field_value
            WHEN 'is_not' THEN v.value <> p_field_value
            WHEN 'contains' THEN v.value ILIKE '%' || p_field_value || '%'
            ELSE FALSE
          END
      )
      ELSE FALSE
    END
    AND NOT EXISTS (
      SELECT 1 FROM contact_tags ct
      WHERE ct.contact_id = c.id
        AND ct.tag_id = ANY (p_exclude_tag_ids)
    );
$$;

COMMENT ON FUNCTION public.broadcast_audience_contact_ids(UUID, TEXT, UUID[], UUID[], UUID, TEXT, TEXT, UUID[], BOOLEAN) IS
  'The one definition of a WhatsApp broadcast recipient: has a phone, has not declined alerts (STOP ALERTS), is not chain-only, dead or archived, optionally has explicitly opted in, matches the audience and carries no excluded tag. Used by both the audience count and the send.';

REVOKE ALL ON FUNCTION public.broadcast_audience_contact_ids(UUID, TEXT, UUID[], UUID[], UUID, TEXT, TEXT, UUID[], BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.broadcast_audience_contact_ids(UUID, TEXT, UUID[], UUID[], UUID, TEXT, TEXT, UUID[], BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.broadcast_audience_contact_ids(UUID, TEXT, UUID[], UUID[], UUID, TEXT, TEXT, UUID[], BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.count_broadcast_audience(
  p_account_id UUID,
  p_type TEXT,
  p_tag_ids UUID[] DEFAULT NULL,
  p_contact_ids UUID[] DEFAULT NULL,
  p_field_id UUID DEFAULT NULL,
  p_field_operator TEXT DEFAULT NULL,
  p_field_value TEXT DEFAULT NULL,
  p_exclude_tag_ids UUID[] DEFAULT NULL,
  p_opted_in_only BOOLEAN DEFAULT FALSE
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)
  FROM broadcast_audience_contact_ids(
    p_account_id,
    p_type,
    p_tag_ids,
    p_contact_ids,
    p_field_id,
    p_field_operator,
    p_field_value,
    p_exclude_tag_ids,
    p_opted_in_only
  )
  WHERE is_account_member(p_account_id, 'agent');
$$;

COMMENT ON FUNCTION public.count_broadcast_audience(UUID, TEXT, UUID[], UUID[], UUID, TEXT, TEXT, UUID[], BOOLEAN) IS
  'How many contacts broadcast_audience_contact_ids would return, without shipping the rows to the composer.';

REVOKE ALL ON FUNCTION public.count_broadcast_audience(UUID, TEXT, UUID[], UUID[], UUID, TEXT, TEXT, UUID[], BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_broadcast_audience(UUID, TEXT, UUID[], UUID[], UUID, TEXT, TEXT, UUID[], BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.count_broadcast_audience(UUID, TEXT, UUID[], UUID[], UUID, TEXT, TEXT, UUID[], BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.contacts_matching_phone_digits(
  p_account_id UUID,
  p_digits TEXT[]
)
RETURNS TABLE (id UUID, phone TEXT, is_merged BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.phone, c.is_merged
  FROM contacts c
  WHERE c.account_id = p_account_id
    AND is_account_member(p_account_id, 'agent')
    AND regexp_replace(c.phone, '\D', '', 'g') = ANY (p_digits);
$$;

COMMENT ON FUNCTION public.contacts_matching_phone_digits(UUID, TEXT[]) IS
  'Every contact in one account, merged, declined, dead and archived included, whose phone stripped to digits equals one of p_digits. Served by idx_contacts_account_phone_norm.';

REVOKE ALL ON FUNCTION public.contacts_matching_phone_digits(UUID, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contacts_matching_phone_digits(UUID, TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.contacts_matching_phone_digits(UUID, TEXT[]) TO authenticated;
