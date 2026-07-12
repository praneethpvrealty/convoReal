-- ============================================================
-- 114_account_lifecycle_log.sql — Audit trail for account archive /
-- reactivate / permanent-delete actions (src/app/api/admin/organizations/[id]/route.ts).
--
-- These are destructive/cross-tenant super-admin actions previously
-- recorded only via console.log. `account_id` is DELIBERATELY NOT a
-- foreign key: the whole point of this table is to survive the account
-- it describes being permanently deleted, so a support/compliance
-- question ("who deleted workspace X and when?") is still answerable
-- after the row is gone. `snapshot` carries whatever identifying
-- details existed at the time (name, owner email, member count) since
-- they can't be joined back later.
--
-- Modeled on contact_merge_log (074) / image_cleanup_log (110):
-- service-role only — RLS on, zero policies. The admin panel already
-- reads organization data via the service-role client
-- (src/app/api/admin/settings/route.ts), so this needs no member-facing
-- SELECT policy.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS account_lifecycle_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL,  -- raw, no FK — must outlive account deletion
  actor_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL CHECK (action IN ('archived', 'reactivated', 'deleted')),
  snapshot       JSONB,          -- { name, owner_user_id, owner_email, member_count, ... }
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE account_lifecycle_log ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT policies: only the service-role admin routes write
-- and read this table (super_admin only, gated at the API layer).

CREATE INDEX IF NOT EXISTS idx_account_lifecycle_log_account
  ON account_lifecycle_log (account_id, created_at DESC);
