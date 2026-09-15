REVOKE ALL PRIVILEGES ON journey_overview_states FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON journey_overview_states
  TO authenticated;

REVOKE ALL PRIVILEGES ON journey_stage_notes FROM anon, authenticated;
GRANT SELECT, INSERT ON journey_stage_notes TO authenticated;
