-- ============================================================
-- 20261109093000_showcase_intent_signals.sql
-- Two showcase intents the agent never saw: shortlisting a listing
-- (kept only in the visitor's browser) and tapping WhatsApp on it
-- (sent only to the Meta Pixel). Both now travel through the Pulse
-- beacon as showcase_events, and an approved exact-location request
-- is recorded as an enquiry on that listing, since on the showcases
-- measured it was the request visitors actually made (32 in 90 days
-- against 2 form enquiries).
-- ============================================================

ALTER TABLE showcase_events
  DROP CONSTRAINT IF EXISTS showcase_events_event_type_check;

ALTER TABLE showcase_events
  ADD CONSTRAINT showcase_events_event_type_check
  CHECK (event_type IN ('open', 'view_property', 'map_click', 'gallery', 'search', 'shortlist', 'whatsapp_click'));

CREATE OR REPLACE FUNCTION public.record_location_request_enquiry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'approved' OR NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO contact_property_inquiries (
    account_id, contact_id, property_id, inquiry_source, inquiry_date
  )
  SELECT NEW.account_id, NEW.contact_id, NEW.property_id, 'Location request', NOW()
  WHERE EXISTS (
    SELECT 1 FROM properties p
    WHERE p.id = NEW.property_id
      AND p.account_id = NEW.account_id
  )
  ON CONFLICT (contact_id, property_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_location_request_enquiry ON property_location_requests;
CREATE TRIGGER record_location_request_enquiry
  AFTER INSERT OR UPDATE OF status ON property_location_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.record_location_request_enquiry();

INSERT INTO contact_property_inquiries (
  account_id, contact_id, property_id, inquiry_source, inquiry_date
)
SELECT r.account_id, r.contact_id, r.property_id, 'Location request', r.created_at
FROM property_location_requests r
JOIN properties p ON p.id = r.property_id AND p.account_id = r.account_id
WHERE r.status = 'approved'
  AND r.contact_id IS NOT NULL
ON CONFLICT (contact_id, property_id) DO NOTHING;
