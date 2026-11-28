ALTER TABLE property_location_requests
  ADD COLUMN IF NOT EXISTS consent_remind_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_reminded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_deadline_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_location_requests_consent_deadline
  ON property_location_requests (consent_deadline_at)
  WHERE status = 'pending' AND pending_consent_contact_id IS NOT NULL;
