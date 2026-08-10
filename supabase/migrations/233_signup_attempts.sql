-- ============================================================
-- 233_signup_attempts.sql
--
-- Who tried to open an account, including everyone who never
-- finished. auth.users only holds signups that succeeded far enough
-- to create a row, so the two cases we most want to see during an
-- invite-only launch are both invisible: a consultant who lands on
-- /signup, reads the invite-only wall and leaves, and one who fills
-- the form and is refused (duplicate email, weak password, no
-- invite). Neither leaves a trace anywhere else.
--
-- Append-only event log, one row per stage, correlated by
-- session_key — same shape as showcase_events, so no updated_at.
--
-- Deliberately NOT account-scoped: it records people who have no
-- account yet. RLS is on with no policy, so anon and authenticated
-- clients can neither read nor write it; the service-role route
-- /api/public/signup-attempt is the only way in, and reads happen
-- through the dashboard or a service-role query.
-- ============================================================

CREATE TABLE IF NOT EXISTS signup_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Correlates the stages of one visit: landed → submitted →
  -- failed/succeeded. Not an identity; it resets with the tab.
  session_key TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('landed', 'submitted', 'failed', 'succeeded')),
  -- Which door they came through, which decides what they were shown:
  -- no_invite gets the waitlist card, the rest get the real form.
  gate TEXT NOT NULL CHECK (gate IN ('no_invite', 'beta', 'team_invite', 'bypass')),
  -- Only set once a form is submitted; a landing records no address.
  email TEXT,
  -- Supabase's own message when a submission was refused, so a wall
  -- that keeps stopping people is legible without guessing.
  error_message TEXT,
  referrer TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signup_attempts_created
  ON signup_attempts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signup_attempts_stage
  ON signup_attempts (stage, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signup_attempts_session
  ON signup_attempts (session_key, created_at);

ALTER TABLE signup_attempts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE signup_attempts IS
  'Append-only funnel log for /signup, including visits that never became users. Service-role writes only.';
