-- ============================================================
-- 213_reengagement_batch_split.sql
-- Which leads in a freshly imported batch can receive the
-- property-anchored message, and which must fall back to the generic
-- status notice.
--
-- property_enquiry_update names the property the lead enquired about.
-- Meta rejects empty body params, and "Property: " with nothing after
-- it is worse than not sending, so eligibility has to be known BEFORE
-- the broadcast is created rather than discovered per recipient at
-- send time.
--
-- has_alternative is reported alongside because it says who will have
-- something to send the moment they tap "Send listings", but it is not
-- a condition for the message itself.
--
-- Answering it in the browser would mean pulling every contact in the
-- batch plus their match events and joining in JS, with an unbounded
-- id list in the filter. It is one indexed statement here.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reengagement_batch_split(
  p_account_id UUID,
  p_tag_id UUID
)
RETURNS TABLE (
  contact_id UUID,
  contact_name TEXT,
  contact_phone TEXT,
  has_enquired_property BOOLEAN,
  has_alternative BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.name,
    c.phone,
    (c.last_inquired_property_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM properties p
         WHERE p.id = c.last_inquired_property_id
           AND p.account_id = p_account_id)),
    EXISTS (
      SELECT 1
        FROM match_events me
        CROSS JOIN LATERAL jsonb_array_elements(me.matches) AS m
        JOIN properties p
          ON p.id = (m->>'id')::uuid
       WHERE me.account_id = p_account_id
         AND me.contact_id = c.id
         AND me.kind = 'buyer_updated'
         AND p.account_id = p_account_id
         -- Only a listing that is actually available, and never the
         -- one they enquired about offered as its own replacement.
         AND p.status = 'Available'
         AND p.id IS DISTINCT FROM c.last_inquired_property_id
         -- Guard the cast: a malformed id in the snapshot must not
         -- error the whole batch.
         AND (m->>'id') ~ '^[0-9a-fA-F-]{36}$'
    )
  FROM contacts c
  JOIN contact_tags ct ON ct.contact_id = c.id AND ct.tag_id = p_tag_id
  WHERE c.account_id = p_account_id
    AND is_account_member(p_account_id)
  ORDER BY c.created_at;
$$;

COMMENT ON FUNCTION public.reengagement_batch_split(UUID, UUID) IS
  'Per-lead eligibility for the property-anchored re-engagement template within one batch tag: whether the enquired property is known and whether an available alternative exists.';

REVOKE ALL ON FUNCTION public.reengagement_batch_split(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reengagement_batch_split(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.reengagement_batch_split(UUID, UUID) TO authenticated;

-- The outcome report must count batches sent on the new template too.
CREATE OR REPLACE FUNCTION public.is_reengagement_template(p_template_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_template_name IN (
    'property_enquiry_status',
    'property_enquiry_update',
    'property_enquiry_followup'
  );
$$;
