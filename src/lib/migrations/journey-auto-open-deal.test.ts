import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEAL_MILESTONE_TEMPLATES } from '@/lib/deals/milestones';

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

describe('[JRN-018] every live journey branch is a deal on the Board', () => {
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

  it('opens one deal per branch, linked to it, on the stage it mirrors', () => {
    expect(migration).toMatch(
      /WHERE account_id = v_item\.account_id AND source_journey_item_id = v_item\.id\s+\) THEN\s+RETURN NULL;/
    );
    expect(migration).toContain(
      'v_item.account_id, v_user, v_stage.pipeline_id, v_stage.pipeline_stage_id,'
    );
    expect(migration).toContain("'converted_from_journey', 'system'");
    expect(migration).toContain("'converted_to_deal'");
  });

  it('adopts the pair’s unlinked deal instead of opening a second one', () => {
    expect(migration).toMatch(
      /AND pipeline_id = v_stage\.pipeline_id\s+AND source_journey_item_id IS NULL\s+ORDER BY created_at, id\s+LIMIT 1;/
    );
    expect(migration).toContain(
      'UPDATE deals SET source_journey_item_id = v_item.id'
    );
    expect(migration).toMatch(
      /SET stage_id = v_stage\.pipeline_stage_id,\s+status = v_status/
    );
  });

  it('re-syncs the listing whenever an adopted deal moves or a deal opens on a closing stage', () => {
    expect(migration).toMatch(
      /IF v_closing OR v_adopted THEN\s+BEGIN\s+PERFORM sync_listing_status_from_deals\(/
    );
    expect(migration).toContain('v_adopted := TRUE;');
  });

  it('seeds the standard closing checklist on a closing stage', () => {
    const literal = (text: string) =>
      `'${text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}'`;
    const keys = DEAL_MILESTONE_TEMPLATES.map((t) => literal(t.key));
    const titles = DEAL_MILESTONE_TEMPLATES.map((t) => literal(t.title));
    expect(migration).toMatch(new RegExp(keys.join('[\\s,]+')));
    expect(migration).toMatch(new RegExp(titles.join('[\\s,]+')));
    expect(migration).toContain("'milestone_added', 'system'");
    expect(migration).toContain(
      "v_closing := v_stage.stage_type IN ('committed', 'won', 'brokerage_pending', 'brokerage_paid');"
    );
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
    expect(backfill).toContain(
      `SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);`
    );
  });
});
