-- ============================================================
-- 190_bug_reports.sql — beta tester bug channel.
--
-- Beta testers who can't file a report in under fifteen seconds
-- don't file reports, so the capture form asks for two things (what
-- happened, how bad) and the client attaches the rest silently.
--
-- build_id is the field that makes a report actionable a week
-- later. "It broke on Tuesday" is not a bug report; a commit SHA
-- is. It comes from NEXT_PUBLIC_BUILD_ID, which vercel.json already
-- sets to the short SHA at build time.
--
-- Ordinary operational table: account_id NOT NULL, RLS on,
-- updated_at trigger, policies through is_account_member().
-- Platform staff read across tenants through a service-role route
-- scoped to CONVOREAL_MASTER_ACCOUNT_ID, not through a policy.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bug_severity') THEN
    CREATE TYPE bug_severity AS ENUM ('blocker', 'major', 'minor', 'idea');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bug_status') THEN
    CREATE TYPE bug_status AS ENUM (
      'new', 'triaged', 'in_progress', 'fixed', 'wont_fix', 'duplicate'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bug_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reported_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  severity bug_severity NOT NULL DEFAULT 'minor',
  status bug_status NOT NULL DEFAULT 'new',

  -- Captured by the client, not typed by the reporter.
  page_url TEXT,
  build_id TEXT,
  user_agent TEXT,
  screenshot_path TEXT,

  -- Triage side. admin_notes is staff-only in the UI but readable by
  -- the tenant under the policies below — keep internal commentary
  -- out of it, or move it behind a service-role-only column later.
  admin_notes TEXT,
  github_issue_url TEXT,

  -- Short human reference shown back to the reporter ("BUG-4F2A"), so
  -- they can quote it instead of describing the report again.
  reference TEXT NOT NULL UNIQUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_account_time
  ON bug_reports (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bug_reports_triage
  ON bug_reports (status, severity, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON bug_reports;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON bug_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;

-- Any member can see their account's reports and file one. Editing
-- is admin+ so a report can't be quietly rewritten after triage
-- starts; status changes come from the service-role admin route.
DROP POLICY IF EXISTS bug_reports_select ON bug_reports;
CREATE POLICY bug_reports_select ON bug_reports FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS bug_reports_insert ON bug_reports;
CREATE POLICY bug_reports_insert ON bug_reports FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP POLICY IF EXISTS bug_reports_update ON bug_reports;
CREATE POLICY bug_reports_update ON bug_reports FOR UPDATE USING (
  is_account_member(account_id, 'admin')
);

COMMENT ON TABLE bug_reports IS
  'Beta tester bug channel. build_id pins the exact deploy a report came from — the field that makes it actionable later. Platform-wide triage reads through a service-role route scoped to CONVOREAL_MASTER_ACCOUNT_ID, not through RLS.';
