-- ============================================================
-- 223_reengagement_text_anchor.sql
-- A lead whose enquired listing never existed in inventory can still
-- receive the property-anchored template: the import stores the
-- portal's own wording of the requirement ("This user is looking for
-- 3 BHK ... in Koramangala, Bangalore") as a contact note, and that
-- prose serves as the template's {{2}} directly. On a real MagicBricks
-- export this lifts anchored coverage from 1/53 (id resolution against
-- empty portal listings) to every lead in the file.
--
-- has_enquired_property therefore now means "the anchored message can
-- be built for this lead", whether from a resolved property row or
-- from requirement text.
--
-- This predicate must stay AT LEAST as strict as
-- extractEnquiredPropertyFromNote (src/lib/contacts/enquiry-note.ts):
-- a lead counted as anchored here whose note the sender then fails to
-- extract is failed at send time instead of falling back to the
-- generic template. The reverse mismatch only costs a lead the richer
-- message, never a send.
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
    (
      (c.last_inquired_property_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM properties p
           WHERE p.id = c.last_inquired_property_id
             AND p.account_id = p_account_id))
      OR EXISTS (
        SELECT 1 FROM contact_notes n
         WHERE n.contact_id = c.id
           AND n.account_id = p_account_id
           -- SQL twin of extractEnquiredPropertyFromNote: the phrase
           -- after "looking for", minus the "and has <verb>ed ..."
           -- trailer and trailing punctuation, must have substance.
           AND length(trim(regexp_replace(regexp_replace(
                 substring(n.note_text from '(?i)looking for\s+(.*)'),
                 '(?i)\s*\yand\s+has\s+[a-z]+ed\y.*$', ''),
                 '[\s.,;:!-]+$', ''))) >= 3
      )
    ),
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
  'Per-lead eligibility for the property-anchored re-engagement template within one batch tag: whether the anchored message can be built (resolved property or extractable requirement text) and whether an available alternative exists.';
