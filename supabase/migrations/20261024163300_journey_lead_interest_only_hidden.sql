-- ============================================================
-- 20261024163300_journey_lead_interest_only_hidden.sql
--
-- The hidden journey items only a lead's own yes captured and nobody
-- reviewed since: their 'added' event reads Captured from lead interest
-- and no 'hidden' or 'unhidden' event follows. The web Journey section
-- reads them for the opened subject so Add, Import inquiries and
-- Import from chat treat them as not yet on the journey, and the
-- browser capture reads them for the pairs it was asked to add so a
-- visible capture can show them (JRN-009, JRN-026). Aggregated in SQL
-- per §2.6 of AGENTS.md: a listing broadcast to hundreds of contacts
-- leaves hundreds of hidden items, and their ids never travel in a URL.
-- Either array may be NULL to mean any; both NULL reads the whole
-- account, which no caller does.
--
-- Additive: a new function. Applied on 24 October 2026; the same pull
-- request then stopped capturing pairs from a lead's yes, so nothing
-- reads it any more. It stays because it is already in production.
-- ============================================================

CREATE OR REPLACE FUNCTION public.journey_lead_interest_only_hidden(
  p_account_id UUID,
  p_contact_ids UUID[] DEFAULT NULL,
  p_property_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  contact_id UUID,
  property_id UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ji.id, ji.contact_id, ji.property_id
  FROM journey_items ji
  WHERE public.is_account_member(p_account_id)
    AND ji.account_id = p_account_id
    AND ji.hidden
    AND (p_contact_ids IS NULL OR ji.contact_id = ANY (p_contact_ids))
    AND (p_property_ids IS NULL OR ji.property_id = ANY (p_property_ids))
    AND EXISTS (
      SELECT 1 FROM journey_events e
      WHERE e.item_id = ji.id
        AND e.event_type = 'added'
        AND e.reason = 'Captured from lead interest'
    )
    AND NOT EXISTS (
      SELECT 1 FROM journey_events e
      WHERE e.item_id = ji.id
        AND e.event_type IN ('hidden', 'unhidden')
    );
$$;

COMMENT ON FUNCTION public.journey_lead_interest_only_hidden(UUID, UUID[], UUID[]) IS
  'Hidden journey items of the caller''s account that only a lead''s own yes captured (added event: Captured from lead interest) and nobody has shown or hidden since, narrowed to the given contacts and/or properties.';

REVOKE ALL ON FUNCTION public.journey_lead_interest_only_hidden(UUID, UUID[], UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.journey_lead_interest_only_hidden(UUID, UUID[], UUID[]) TO authenticated;
