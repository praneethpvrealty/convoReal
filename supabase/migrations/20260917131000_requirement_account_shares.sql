CREATE TABLE IF NOT EXISTS requirement_account_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  sender_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  reference TEXT NOT NULL,
  brief JSONB NOT NULL,
  sender_name TEXT,
  sender_account_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'viewed', 'responded', 'declined')),
  viewed_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, contact_id, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_requirement_account_shares_recipient
  ON requirement_account_shares(recipient_account_id, recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requirement_account_shares_sender
  ON requirement_account_shares(account_id, created_at DESC);

ALTER TABLE requirement_account_shares ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_requirement_account_shares_updated_at
  ON requirement_account_shares;
CREATE TRIGGER set_requirement_account_shares_updated_at
  BEFORE UPDATE ON requirement_account_shares
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

REVOKE ALL ON TABLE requirement_account_shares FROM anon, authenticated;
GRANT ALL ON TABLE requirement_account_shares TO service_role;

CREATE TABLE IF NOT EXISTS requirement_account_share_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sender_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  share_id UUID NOT NULL REFERENCES requirement_account_shares(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  responder_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(share_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_requirement_account_share_responses_share
  ON requirement_account_share_responses(share_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requirement_account_share_responses_sender
  ON requirement_account_share_responses(sender_account_id, created_at DESC);

ALTER TABLE requirement_account_share_responses ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_requirement_account_share_responses_updated_at
  ON requirement_account_share_responses;
CREATE TRIGGER set_requirement_account_share_responses_updated_at
  BEFORE UPDATE ON requirement_account_share_responses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

REVOKE ALL ON TABLE requirement_account_share_responses FROM anon, authenticated;
GRANT ALL ON TABLE requirement_account_share_responses TO service_role;
