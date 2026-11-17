-- Referred enquiries: an enquiry made by a guest who reached the
-- showcase through a link the listing side shared with an agent.
--
-- location-requests.ts already holds the principle for location
-- reveals: a co-broker's client must not be poachable through the
-- link the co-broker forwarded. An enquiry broke it. The guest's name
-- and number went straight into the listing account as an ordinary
-- lead and the bot started talking to them, with the agent who
-- forwarded the link never told.
--
-- A row here holds such an enquiry while the agent decides. The guest
-- stays out of the contacts list until the agent approves; a decline,
-- or two hours of silence, sends the guest back to the agent.
--
-- The row carries the guest's name and number in the clear, so RLS is
-- on with no policy: it is read and written only by the service role,
-- which hands the listing side a masked identity until approval.
--
-- Additive only: one new table.

CREATE TABLE IF NOT EXISTS referred_enquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  via_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('website', 'whatsapp')),
  requester_name TEXT NOT NULL,
  requester_phone TEXT NOT NULL,
  session_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  consent_requested_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referred_enquiries_guest
  ON referred_enquiries (account_id, via_contact_id, requester_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referred_enquiries_pending
  ON referred_enquiries (consent_requested_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_referred_enquiries_pending_contact
  ON referred_enquiries (contact_id)
  WHERE status = 'pending' AND contact_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at'
      AND tgrelid = 'referred_enquiries'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at BEFORE UPDATE ON referred_enquiries
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

ALTER TABLE referred_enquiries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE referred_enquiries IS
  'Enquiries from a guest of an agent''s forwarded showcase link, held until that agent approves. Service-role only: the guest''s identity is masked from the listing side while pending.';
