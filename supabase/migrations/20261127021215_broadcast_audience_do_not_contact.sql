-- Broadcast and greeting audiences leave out contacts marked Do not
-- contact (20261127012430_contact_do_not_contact.sql). The exclusion
-- lives here, not after the fact in the sender, so count_broadcast_audience
-- (which counts these rows) previews exactly the people the send reaches.
-- Replaces a live function: apply once the change has merged into main.

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
    AND NOT c.do_not_contact
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
