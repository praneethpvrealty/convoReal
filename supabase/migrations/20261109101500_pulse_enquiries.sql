-- ============================================================
-- 20261109101500_pulse_enquiries.sql
-- One feed of everything a showcase visitor asked for. Until now a
-- form enquiry went to the Inbox, Today and a to-do, an exact-location
-- or document request to the approval panels, a fit rating nowhere,
-- and a shortlist or WhatsApp tap nowhere at all, so the question
-- "where do I see the enquiries?" had five answers. Pulse answers it
-- once, from this function, on web and mobile alike.
--
-- Rows come newest first in keyset pages (occurred_at, then id), the
-- same way the activity feed pages, and the account guard sits in
-- every branch so a member of another account gets nothing.
-- ============================================================

CREATE OR REPLACE FUNCTION public.pulse_enquiries(
  p_account_id UUID,
  p_before TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER DEFAULT 40
)
RETURNS TABLE (
  kind TEXT,
  id UUID,
  occurred_at TIMESTAMPTZ,
  contact_id UUID,
  contact_name TEXT,
  contact_phone TEXT,
  property_id UUID,
  property_title TEXT,
  property_code TEXT,
  detail JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rows AS (
    SELECT
      'enquiry'::TEXT AS kind,
      i.id,
      COALESCE(i.inquiry_date, i.created_at) AS occurred_at,
      i.contact_id,
      i.property_id,
      jsonb_build_object(
        'source', i.inquiry_source,
        'via_portal_link', i.via_portal_link
      ) AS detail
    FROM contact_property_inquiries i
    WHERE i.account_id = p_account_id

    UNION ALL

    SELECT
      'location_request',
      r.id,
      r.created_at,
      r.contact_id,
      r.property_id,
      jsonb_build_object(
        'status', r.status,
        'requester_name', r.requester_name,
        'requester_phone', r.requester_phone
      )
    FROM property_location_requests r
    WHERE r.account_id = p_account_id

    UNION ALL

    SELECT
      'document_request',
      d.id,
      d.created_at,
      NULL::UUID,
      d.property_id,
      jsonb_build_object(
        'status', d.status,
        'requester_name', d.requester_name,
        'requester_phone', d.requester_phone
      )
    FROM property_document_requests d
    WHERE d.account_id = p_account_id

    UNION ALL

    SELECT
      'rating',
      pr.id,
      COALESCE(pr.updated_at, pr.created_at),
      pr.contact_id,
      pr.property_id,
      jsonb_build_object(
        'rating', pr.rating,
        'miss_reasons', to_jsonb(pr.miss_reasons),
        'session_key', left(pr.session_key, 8)
      )
    FROM property_ratings pr
    WHERE pr.account_id = p_account_id

    UNION ALL

    SELECT
      CASE e.event_type WHEN 'shortlist' THEN 'shortlist' ELSE 'whatsapp_tap' END,
      e.id,
      e.created_at,
      e.contact_id,
      e.property_id,
      e.metadata || jsonb_build_object('session_key', left(e.session_key, 8))
    FROM showcase_events e
    WHERE e.account_id = p_account_id
      AND e.event_type IN ('shortlist', 'whatsapp_click')
      AND (e.event_type <> 'shortlist' OR e.metadata->>'action' = 'add')

    UNION ALL

    SELECT
      'check_in',
      n.id,
      COALESCE(n.sent_at, n.created_at),
      n.contact_id,
      n.property_id,
      jsonb_build_object(
        'channel', n.channel,
        'response', n.response,
        'responded_at', n.responded_at,
        'dwell_ms', n.dwell_ms
      )
    FROM showcase_view_nudges n
    WHERE n.account_id = p_account_id
      AND n.status = 'sent'
  )
  SELECT
    r.kind,
    r.id,
    r.occurred_at,
    r.contact_id,
    c.name AS contact_name,
    c.phone AS contact_phone,
    r.property_id,
    p.title AS property_title,
    p.property_code,
    r.detail
  FROM rows r
  LEFT JOIN contacts c ON c.id = r.contact_id AND c.account_id = p_account_id
  LEFT JOIN properties p ON p.id = r.property_id AND p.account_id = p_account_id
  WHERE is_account_member(p_account_id)
    AND (p_before IS NULL OR r.occurred_at < p_before)
  ORDER BY r.occurred_at DESC, r.id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.pulse_enquiry_counts(
  p_account_id UUID,
  p_since TIMESTAMPTZ
)
RETURNS TABLE (kind TEXT, total BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.kind, k.total
  FROM (
    SELECT 'enquiry'::TEXT AS kind, count(*) AS total
    FROM contact_property_inquiries i
    WHERE i.account_id = p_account_id
      AND COALESCE(i.inquiry_date, i.created_at) >= p_since
    UNION ALL
    SELECT 'location_request', count(*)
    FROM property_location_requests r
    WHERE r.account_id = p_account_id AND r.created_at >= p_since
    UNION ALL
    SELECT 'document_request', count(*)
    FROM property_document_requests d
    WHERE d.account_id = p_account_id AND d.created_at >= p_since
    UNION ALL
    SELECT 'rating', count(*)
    FROM property_ratings pr
    WHERE pr.account_id = p_account_id
      AND COALESCE(pr.updated_at, pr.created_at) >= p_since
    UNION ALL
    SELECT 'shortlist', count(*)
    FROM showcase_events e
    WHERE e.account_id = p_account_id
      AND e.event_type = 'shortlist'
      AND e.metadata->>'action' = 'add'
      AND e.created_at >= p_since
    UNION ALL
    SELECT 'whatsapp_tap', count(*)
    FROM showcase_events e
    WHERE e.account_id = p_account_id
      AND e.event_type = 'whatsapp_click'
      AND e.created_at >= p_since
    UNION ALL
    SELECT 'check_in', count(*)
    FROM showcase_view_nudges n
    WHERE n.account_id = p_account_id
      AND n.status = 'sent'
      AND COALESCE(n.sent_at, n.created_at) >= p_since
  ) k
  WHERE is_account_member(p_account_id);
$$;

GRANT EXECUTE ON FUNCTION public.pulse_enquiries(UUID, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pulse_enquiry_counts(UUID, TIMESTAMPTZ) TO authenticated;
