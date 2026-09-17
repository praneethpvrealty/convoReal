CREATE INDEX IF NOT EXISTS idx_requirement_account_shares_contact
  ON requirement_account_shares(contact_id);
CREATE INDEX IF NOT EXISTS idx_requirement_account_shares_recipient_contact
  ON requirement_account_shares(recipient_contact_id);
CREATE INDEX IF NOT EXISTS idx_requirement_account_shares_recipient_user
  ON requirement_account_shares(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_requirement_account_shares_sender_user
  ON requirement_account_shares(sender_user_id);

CREATE INDEX IF NOT EXISTS idx_requirement_account_share_responses_account
  ON requirement_account_share_responses(account_id);
CREATE INDEX IF NOT EXISTS idx_requirement_account_share_responses_property
  ON requirement_account_share_responses(property_id);
CREATE INDEX IF NOT EXISTS idx_requirement_account_share_responses_responder
  ON requirement_account_share_responses(responder_user_id);
