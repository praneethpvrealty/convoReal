-- ============================================================
-- 261_owner_details_request_settings.sql
-- Per-account wording for the owner property-details request — the
-- first message an agent sends a seller (src/lib/owners/
-- details-request.ts).
--
-- The message ships with built-in wording. This table lets a brokerage
-- replace it with their own, without touching code and without going
-- anywhere near Meta template approval — the request is an Engine
-- template, not a WhatsApp one.
--
-- Two independent knobs, either of which may be unset:
--   sections       which parts of the checklist the first ask carries.
--                  Empty means "use the built-in default", which is the
--                  minimum ask: what the property is, the price, and
--                  photos. Papers are deliberately NOT in it — those
--                  are shared after a buyer is finalised and the token
--                  is paid.
--   body_template  the whole message, with {{placeholders}}. NULL
--                  composes the built-in prose. {{checklist}} drops in
--                  the type-aware section list, so an account can
--                  rewrite every sentence and still never ask a plot
--                  owner for a BHK configuration.
--
-- One row per account. Reading is open to every member because the
-- send dialog needs it; writing is admin-only, matching canEditSettings.
-- ============================================================

CREATE TABLE IF NOT EXISTS owner_details_request_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sections TEXT[] NOT NULL DEFAULT '{}',
  body_template TEXT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id)
);

ALTER TABLE owner_details_request_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_details_request_settings_select
  ON owner_details_request_settings;
CREATE POLICY owner_details_request_settings_select
  ON owner_details_request_settings FOR SELECT USING (
    is_account_member(account_id)
  );

DROP POLICY IF EXISTS owner_details_request_settings_modify
  ON owner_details_request_settings;
CREATE POLICY owner_details_request_settings_modify
  ON owner_details_request_settings FOR ALL USING (
    is_account_member(account_id, 'admin')
  ) WITH CHECK (
    is_account_member(account_id, 'admin')
  );

DROP TRIGGER IF EXISTS set_owner_details_request_settings_updated_at
  ON owner_details_request_settings;
CREATE TRIGGER set_owner_details_request_settings_updated_at
  BEFORE UPDATE ON owner_details_request_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
