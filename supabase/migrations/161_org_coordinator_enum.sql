-- ============================================================
-- 161_org_coordinator_enum.sql
--
-- Adds the 'coordinator' scoped-operator role to BOTH role enums:
--   account_role_enum -> 'coordinator'   (legacy axis, 017)
--   org_role_enum     -> 'org_coordinator' (org axis, 082)
--
-- A Coordinator is an agent-level operator with account-wide
-- visibility of contacts + conversations (including the unassigned
-- inbox queue), but NO member management, settings, hard-delete,
-- account-delete, or ownership-transfer powers. It's the role for
-- someone who maintains inventory/contacts, posts listings to
-- portals, and answers unattended messages.
--
-- WHY THIS IS A SEPARATE MIGRATION FROM 162:
--   Postgres forbids using a newly-added enum value in the SAME
--   transaction that adds it (ALTER TYPE ... ADD VALUE). Migration
--   162 references both new values in function bodies (is_account_member,
--   sync_legacy_account_role) and RLS policies, so the ADD VALUE must
--   commit first. The Supabase CLI runs each migration file in its own
--   transaction — same split already used by 082 (creates org_role_enum)
--   and 083 (first uses it).
--
-- Idempotent — IF NOT EXISTS guards re-runs.
-- ============================================================

ALTER TYPE account_role_enum ADD VALUE IF NOT EXISTS 'coordinator';
ALTER TYPE org_role_enum ADD VALUE IF NOT EXISTS 'org_coordinator';
