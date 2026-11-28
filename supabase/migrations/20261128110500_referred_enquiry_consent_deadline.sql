ALTER TABLE referred_enquiries
  ADD COLUMN IF NOT EXISTS consent_remind_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_reminded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_deadline_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_referred_enquiries_consent_deadline
  ON referred_enquiries (consent_deadline_at)
  WHERE status = 'pending';
