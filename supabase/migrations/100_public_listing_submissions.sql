-- ============================================================
-- 100_public_listing_submissions.sql — Seller "list your property"
--   web funnel with reverse WhatsApp verification.
--
-- Originally authored and applied as 098; renamed to 100 after a
-- concurrent, unrelated fix (098_fix_signup_role_sync_trigger.sql /
-- 099_fix_handle_new_user_account_role_type.sql) also claimed 098. The
-- table was already live under the old filename, so this rename is
-- pure repo hygiene — no re-run needed.
--
-- A seller pastes listing details + uploads photos on the public
-- /list page (the heavy content). Instead of creating a property
-- immediately (which would let anonymous traffic burn the agent's
-- AI parse credits), the raw submission is stashed here with a short
-- code and a 24h expiry. The seller taps a wa.me link and sends that
-- code to the agent's WhatsApp; the inbound webhook matches the code,
-- verifies the sender owns the number, THEN parses + creates the
-- Pending-Review property. Parsing (credit-metered) happens only
-- after verification, so an abuser who never messages costs nothing.
--
-- Service-role only: every reader (public submit route, webhook
-- handler) uses the admin client. RLS is enabled with no policies so
-- anon/authenticated are denied by default; service_role bypasses.
-- ============================================================

CREATE TABLE IF NOT EXISTS public_listing_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Short human-typable verification code (e.g. 'LIST-A7K2'). The
  -- seller sends this to the agent's WhatsApp to prove number
  -- ownership and trigger processing.
  code TEXT NOT NULL,

  -- Raw listing text pasted by the seller + uploaded photo URLs.
  -- Parsed into structured fields only on verification.
  raw_text TEXT NOT NULL,
  images TEXT[] NOT NULL DEFAULT '{}',
  submitter_name TEXT,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'expired')),

  -- Populated on verification: the WhatsApp number that sent the code
  -- (the proven owner) and the resulting draft property.
  verified_phone TEXT,
  created_property_id UUID REFERENCES properties(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  verified_at TIMESTAMPTZ
);

-- Codes are looked up by (account_id, code); unique within an account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pls_account_code
  ON public_listing_submissions(account_id, code);

-- Expiry sweeps only care about still-pending rows.
CREATE INDEX IF NOT EXISTS idx_pls_pending_expiry
  ON public_listing_submissions(expires_at) WHERE status = 'pending';

ALTER TABLE public_listing_submissions ENABLE ROW LEVEL SECURITY;
