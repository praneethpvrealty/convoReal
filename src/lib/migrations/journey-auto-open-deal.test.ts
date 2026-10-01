import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261001032159_journey_auto_open_deal.sql'
  ),
  'utf8'
);
const backfill = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261001032200_journey_auto_open_deal_backfill.sql'
  ),
  'utf8'
);

describe('[JRN-016] every live journey branch is a deal on the Board', () => {
  it('opens the deal when a branch is captured, shown, moved or reactivated', () => {
    expect(migration).toMatch(
      /CREATE TRIGGER journey_auto_open_deal_trigger\s+AFTER INSERT OR UPDATE OF hidden, stage_id, status ON journey_items\s+FOR EACH ROW\s+WHEN \(NOT NEW\.hidden AND NEW\.status = 'active'\)\s+EXECUTE FUNCTION journey_auto_open_deal\(\)/
    );
  });

  it('leaves the Captured tray, dropped branches and unmirrored stages off the Board', () => {
    expect(migration).toContain(
      "IF NOT FOUND OR v_item.hidden OR v_item.status <> 'active' THEN"
    );
    expect(migration).toMatch(
      /JOIN pipeline_stages ps ON ps\.id = js\.pipeline_stage_id\s+WHERE js\.id = v_item\.stage_id AND js\.account_id = v_item\.account_id;\s+IF NOT FOUND THEN\s+RETURN NULL;/
    );
  });

  it('opens one deal per pair, linked to the branch, on the stage it mirrors', () => {
    expect(migration).toMatch(
      /source_journey_item_id = v_item\.id\s+OR \(contact_id = v_item\.contact_id AND property_id = v_item\.property_id\)/
    );
    expect(migration).toContain(
      'v_item.account_id, v_user, v_stage.pipeline_id, v_stage.pipeline_stage_id,'
    );
    expect(migration).toContain("'converted_from_journey', 'system'");
    expect(migration).toContain("'converted_to_deal'");
  });

  it('never reopens a deal deleted from the Board, and never blocks the journey write', () => {
    expect(migration).toContain(
      "IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 THEN"
    );
    expect(migration).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/);
  });

  it('keeps the opener off the public API', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION journey_open_deal_for_item(UUID) FROM PUBLIC, anon, authenticated;'
    );
  });

  it('backfills every live branch through the same opener', () => {
    expect(backfill).toContain('SELECT journey_open_deal_for_item(ji.id)');
    expect(backfill).toContain('AND js.pipeline_stage_id IS NOT NULL');
  });
});
