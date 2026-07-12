-- ============================================================
-- 113_account_archival.sql — Soft-archive & hard-delete lifecycle
--
-- Adds three columns to `accounts`:
--   status      — 'active' (default) or 'archived'
--   archived_at — timestamp when the admin archived the account
--   archived_by — the super-admin user id who performed the action
--
-- Archived accounts remain in the DB with all their data intact.
-- The dashboard shell gates on this status and renders a read-only
-- overlay. A hard DELETE via the admin API uses Postgres CASCADE to
-- purge all child rows (contacts, messages, properties, …).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Fast filter for admin list queries
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts (status);

-- Allow account members to see the status so the dashboard shell can
-- gate on it (the RLS policy already grants SELECT to members).
-- No new policy needed — the existing accounts_select policy covers it.
