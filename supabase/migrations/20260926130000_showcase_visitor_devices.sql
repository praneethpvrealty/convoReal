-- ============================================================
-- 20260926130000_showcase_visitor_devices.sql
--
-- A personalized showcase link (?v=<contact_id>) is forwarded as easily
-- as it is opened, and until now every open of a forwarded link landed
-- in Pulse under the original recipient's name. This binds each
-- personalized link to the first browser that opens it: that session
-- becomes the contact's known device, and any other device presenting
-- the same v= is a forwarded viewer — recorded as a guest referred by
-- that contact (via_contact_id), never as the contact. A device also
-- becomes known when the visitor identifies themselves (inquiry, Ask
-- chat), so a forwarded guest who leaves a phone number is attributed
-- from then on, and a known device is attributed on later visits even
-- when it arrives on the bare link.
-- ============================================================

CREATE TABLE IF NOT EXISTS showcase_visitor_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, session_key)
);

CREATE INDEX IF NOT EXISTS idx_showcase_visitor_devices_contact
  ON showcase_visitor_devices (account_id, contact_id);

DROP TRIGGER IF EXISTS set_updated_at ON showcase_visitor_devices;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON showcase_visitor_devices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE showcase_visitor_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS showcase_visitor_devices_select ON showcase_visitor_devices;
CREATE POLICY showcase_visitor_devices_select ON showcase_visitor_devices FOR SELECT USING (
  is_account_member(account_id)
);

-- Rows are written only by the public beacon and lead-capture routes
-- (service role), so a browser can never claim a contact for itself.

ALTER TABLE showcase_events
  ADD COLUMN IF NOT EXISTS via_contact_id UUID
    CONSTRAINT showcase_events_via_contact_id_fkey
    REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_showcase_events_via_contact
  ON showcase_events (account_id, via_contact_id, created_at DESC)
  WHERE via_contact_id IS NOT NULL;

-- Resolves who a beacon belongs to. A session already known as a
-- contact's device stays that contact whatever link it arrived on. An
-- unknown session presenting a v= claims the contact only while no
-- device has claimed it yet; otherwise it is a forwarded viewer and the
-- link's contact is returned as via_contact_id. The contact row lock
-- serializes two unknown sessions racing to claim the same contact.
CREATE OR REPLACE FUNCTION public.resolve_showcase_visitor(
  p_account_id UUID,
  p_session_key TEXT,
  p_contact_id UUID
)
RETURNS TABLE (contact_id UUID, via_contact_id UUID)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_known UUID;
  v_link_contact UUID;
BEGIN
  SELECT d.contact_id INTO v_known
  FROM showcase_visitor_devices d
  WHERE d.account_id = p_account_id
    AND d.session_key = p_session_key;

  IF p_contact_id IS NOT NULL THEN
    SELECT c.id INTO v_link_contact
    FROM contacts c
    WHERE c.id = p_contact_id
      AND c.account_id = p_account_id
    FOR UPDATE;
  END IF;

  IF v_known IS NOT NULL THEN
    RETURN QUERY SELECT
      v_known,
      CASE WHEN v_link_contact IS DISTINCT FROM v_known THEN v_link_contact END;
    RETURN;
  END IF;

  IF v_link_contact IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM showcase_visitor_devices d
    WHERE d.account_id = p_account_id
      AND d.contact_id = v_link_contact
  ) THEN
    RETURN QUERY SELECT NULL::UUID, v_link_contact;
    RETURN;
  END IF;

  INSERT INTO showcase_visitor_devices (account_id, contact_id, session_key)
  VALUES (p_account_id, v_link_contact, p_session_key)
  ON CONFLICT (account_id, session_key) DO NOTHING;

  RETURN QUERY SELECT v_link_contact, NULL::UUID;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_showcase_visitor(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_showcase_visitor(UUID, TEXT, UUID) TO service_role;

COMMENT ON FUNCTION public.resolve_showcase_visitor(UUID, TEXT, UUID) IS
  'Pulse beacon identity: known device wins; first device to open a personalized link claims it; later devices are forwarded viewers.';

-- Contacts already seen in Pulse keep the device they were first seen
-- on, so an existing recipient is not demoted to a forwarded guest by
-- their own next visit.
INSERT INTO showcase_visitor_devices (account_id, contact_id, session_key, created_at)
SELECT DISTINCT ON (e.account_id, e.contact_id)
  e.account_id, e.contact_id, e.session_key, e.created_at
FROM showcase_events e
JOIN contacts c ON c.id = e.contact_id AND c.account_id = e.account_id
WHERE e.contact_id IS NOT NULL
ORDER BY e.account_id, e.contact_id, e.created_at ASC, e.id ASC
ON CONFLICT (account_id, session_key) DO NOTHING;
