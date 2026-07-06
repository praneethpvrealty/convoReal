-- ============================================================
-- 086_referrals.sql — Referral relationships
--
-- Tracks the referrer/referee relationship and its lifecycle:
--   pending -> active (7-day activation) -> converted (paid upgrade)
--                                        -> expired (never converted)
--   pending -> invalid (abuse detected, pending reward voided)
--
-- Source design: ConvoReal-Engineering-OS/CREDITS_AND_REFERRAL_DESIGN.md §6
-- ============================================================

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  referee_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',    -- signed up, referrer reward sitting in pending_referral_credits
    'active',     -- 7-day activation confirmed, reward promoted to spendable
    'converted',  -- upgraded to paid plan (separate, instant, spendable reward)
    'expired',    -- never activated/converted within a reasonable window
    'invalid'     -- abuse detected, pending reward voided
  )),

  referee_plan TEXT,
  passive_earn_months INTEGER NOT NULL DEFAULT 0,
  passive_earn_expires_at TIMESTAMPTZ,

  -- Abuse-prevention (cheap signals only — no OTP-based phone
  -- verification exists in this codebase yet, so "verified" here
  -- means the referee has a captured phone number, same bar as the
  -- rest of the WhatsApp CRM signup flow).
  referee_phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  signup_ip INET,  -- logged for future subnet-abuse analysis, not enforced yet

  signed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,

  UNIQUE(referee_account_id)  -- one referral source per account
);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- Referrer sees their outgoing referrals; referee's own account sees
-- the single row naming them (so a fresh signup can show "welcome
-- bonus applied" without exposing the referrer's other referrals).
DROP POLICY IF EXISTS referrals_select ON referrals;
CREATE POLICY referrals_select ON referrals FOR SELECT
  USING (
    is_account_member(referrer_account_id)
    OR is_account_member(referee_account_id)
  );
-- No client INSERT/UPDATE policy — service-role / SECURITY DEFINER only.

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_account_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_referee ON referrals(referee_account_id);
CREATE INDEX IF NOT EXISTS idx_referrals_pending_activation ON referrals(status, signed_up_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_referrals_passive_earn ON referrals(status, passive_earn_expires_at) WHERE status = 'converted';
