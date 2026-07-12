-- ============================================================
-- 115_admin_plan_otp_challenges.sql — WhatsApp OTP step-up for the
-- admin plan-override feature (super-admin upgrades/downgrades any
-- account's plan without going through the payment gateway).
--
-- Modeled on account_invitations (017_account_sharing.sql): the code
-- is hashed at rest (never stored in plaintext), single-use via
-- `used_at`, time-limited via `expires_at`, and brute-force-limited
-- via `attempts`. Every challenge is bound to a specific admin +
-- account + target plan, so a code can never be replayed against a
-- different change (see evaluateChallenge in
-- src/lib/billing/admin-plan-override.ts).
--
-- Service-role only — RLS on, zero policies. Only the two admin plan
-- routes (challenge issue + verify) ever touch this table, both
-- gated by profiles.role = 'super_admin'.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_plan_otp_challenges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  from_plan      TEXT NOT NULL CHECK (from_plan IN ('starter','solo_pro','team','agency')),
  to_plan        TEXT NOT NULL CHECK (to_plan IN ('starter','solo_pro','team','agency')),
  code_hash      TEXT NOT NULL,             -- SHA-256 hex of the 6-digit code, never plaintext
  attempts       INT  NOT NULL DEFAULT 0,
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ,               -- single-use consumption marker
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE admin_plan_otp_challenges ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE policies: only the service-role admin plan
-- routes read or write this table (super_admin only, gated at the API
-- layer via checkSuperAdmin()).

CREATE INDEX IF NOT EXISTS idx_admin_plan_otp_challenges_admin
  ON admin_plan_otp_challenges (admin_user_id, created_at DESC);
