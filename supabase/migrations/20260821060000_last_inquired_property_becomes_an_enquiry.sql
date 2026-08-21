-- ============================================================
-- 20260821060000_last_inquired_property_becomes_an_enquiry.sql
--
-- A contact carries the listing they asked about in two places, and
-- only one of them was ever read back.
--
--   contacts.last_inquired_property_id  — written by the showcase lead
--     path (findOrCreateContact), the WhatsApp chatbot, and an agent
--     editing the contact by hand.
--   contact_property_inquiries          — written by the portal email
--     leads (Housing, MagicBricks, 99acres), the manual picker and the
--     chatbot's specific-listing branch.
--
-- Match rows, digests and inquired-intent all read the second one, so a
-- buyer who came in off the showcase asking about PROP-1072 showed no
-- enquiry anywhere: 91 contacts on the production account at the time
-- of writing.
--
-- A trigger rather than a call at each write site: three code paths
-- already set the column, one of them a client update straight through
-- RLS, and a fourth will be added by somebody who never reads this file.
-- The rule belongs where no writer can miss it.
--
-- ON CONFLICT DO NOTHING, so re-stating an interest never rewrites the
-- date on which it was first recorded.
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_last_inquired_property()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.last_inquired_property_id IS NULL OR NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO contact_property_inquiries (
    account_id, contact_id, property_id, inquiry_source, inquiry_date
  )
  SELECT NEW.account_id, NEW.id, NEW.last_inquired_property_id, 'Stated interest', NOW()
  WHERE EXISTS (
    SELECT 1 FROM properties p
    WHERE p.id = NEW.last_inquired_property_id
      AND p.account_id = NEW.account_id
  )
  ON CONFLICT (contact_id, property_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_last_inquired_property ON contacts;
CREATE TRIGGER record_last_inquired_property
  AFTER INSERT OR UPDATE OF last_inquired_property_id ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.record_last_inquired_property();

-- Backfill what the column already knows. The enquiry itself has no
-- recorded time, so the contact's own timestamps stand in — closer to
-- the truth than NOW(), which would date every one of them to this
-- migration and sort them above genuinely recent enquiries.
INSERT INTO contact_property_inquiries (
  account_id, contact_id, property_id, inquiry_source, inquiry_date
)
SELECT
  c.account_id,
  c.id,
  c.last_inquired_property_id,
  'Stated interest',
  COALESCE(c.updated_at, c.created_at, NOW())
FROM contacts c
JOIN properties p
  ON p.id = c.last_inquired_property_id
 AND p.account_id = c.account_id
WHERE c.last_inquired_property_id IS NOT NULL
  AND c.account_id IS NOT NULL
ON CONFLICT (contact_id, property_id) DO NOTHING;
