import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260927030000_journey_close_and_deal_delete_sync.sql'
  ),
  'utf8'
);

describe('[JRN-011] closing a journey and deleting a deal reach the other side', () => {
  it('drops the live branches of a closed journey and marks their deals lost', () => {
    expect(sql).toMatch(
      /AFTER INSERT OR UPDATE OF lifecycle_status ON journey_overview_states/
    );
    expect(sql).toContain(
      "IF NEW.lifecycle_status IN ('completed', 'not_proceeding') THEN"
    );
    expect(sql).toContain("SET status = 'dropped'");
    expect(sql).toContain("NOT (p_keep_won AND js.stage_kind = 'won')");
    expect(sql).toContain("NEW.lifecycle_status = 'completed',");
    expect(sql).toMatch(/UPDATE deals d\s+SET status = 'lost'/);
  });

  it('keeps the helpers trigger-only', () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION journey_close_branches\(UUID, TEXT, UUID, TEXT, BOOLEAN, UUID\)\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION journey_reopen_branches\(UUID, TEXT, UUID, UUID\)\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION journey_reopen_overview_for_item\(UUID, UUID, UUID\)\s+FROM PUBLIC, anon, authenticated;/
    );
  });

  it('reopens a closed overview when one of its branches comes back to life', () => {
    expect(sql).toContain(
      "WHERE account_id = p_account_id\n    AND lifecycle_status IN ('completed', 'not_proceeding')"
    );
    expect(sql).toMatch(
      /IF v_status = 'active' AND v_from_status = 'dropped' THEN\s+PERFORM journey_reopen_overview_for_item\(NEW\.account_id, NEW\.source_journey_item_id, auth\.uid\(\)\);/
    );
    expect(sql).toMatch(
      /IF NEW\.status = 'active' AND OLD\.status = 'dropped' THEN\s+PERFORM journey_reopen_overview_for_item\(NEW\.account_id, NEW\.id, auth\.uid\(\)\);/
    );
  });

  it('reopens exactly the branches the close dropped and restores their deals', () => {
    expect(sql).toContain("AND v_was IN ('completed', 'not_proceeding') THEN");
    expect(sql).toContain("AND ji.drop_reason LIKE 'Journey closed:%'");
    expect(sql).toContain("(last_drop.metadata ->> 'mode') = p_mode");
    expect(sql).toContain(
      "(last_drop.metadata ->> 'subject_id') = p_subject_id::text"
    );
    expect(sql).toMatch(/'reactivated'/);
    expect(sql).toMatch(
      /status = CASE js\.stage_kind WHEN 'won' THEN 'won' WHEN 'lost' THEN 'lost' ELSE 'open' END/
    );
  });

  it('leaves a paused or archived journey alone', () => {
    expect(sql).not.toMatch(/'paused'/);
    expect(sql).not.toMatch(/archived_at/);
  });

  it('drops a deleted deal’s branch with the reason on record', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER journey_drop_on_deal_delete_trigger\s+AFTER DELETE ON deals\s+FOR EACH ROW EXECUTE FUNCTION journey_drop_on_deal_delete\(\)/
    );
    expect(sql).toContain("drop_reason = 'Deal deleted'");
    expect(sql).toContain(
      "jsonb_build_object('deleted_deal', OLD.id, 'deal_title', OLD.title)"
    );
  });
});
