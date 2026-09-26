import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sync = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260926123000_journey_deal_link_sync.sql'
  ),
  'utf8'
);
const backfill = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260926123100_journey_deal_link_backfill.sql'
  ),
  'utf8'
);

describe('[JRN-011] a deal and its journey branch describe one item', () => {
  it('links every new deal with a contact and a property to the pair’s branch', () => {
    expect(sync).toMatch(
      /CREATE TRIGGER journey_link_deal_trigger\s+AFTER INSERT ON deals\s+FOR EACH ROW EXECUTE FUNCTION journey_link_deal\(\)/
    );
    expect(sync).toContain('OR NEW.contact_id IS NULL');
    expect(sync).toContain('OR NEW.property_id IS NULL');
    expect(sync).toContain(
      'ON CONFLICT (account_id, contact_id, property_id) DO NOTHING'
    );
    expect(sync).toContain(
      'UPDATE deals SET source_journey_item_id = v_item WHERE id = NEW.id'
    );
  });

  it('leaves a second deal for the same pair unlinked', () => {
    expect(sync).toMatch(
      /SELECT 1 FROM deals\s+WHERE source_journey_item_id = v_item AND id <> NEW\.id/
    );
  });

  it('carries stage and outcome both ways, not stage alone', () => {
    expect(sync).toMatch(
      /AFTER UPDATE OF stage_id, status ON deals\s+FOR EACH ROW\s+WHEN \(OLD\.stage_id IS DISTINCT FROM NEW\.stage_id OR OLD\.status IS DISTINCT FROM NEW\.status\)/
    );
    expect(sync).toMatch(
      /AFTER UPDATE OF stage_id, status ON journey_items\s+FOR EACH ROW\s+WHEN \(OLD\.stage_id IS DISTINCT FROM NEW\.stage_id OR OLD\.status IS DISTINCT FROM NEW\.status\)/
    );
    expect(sync).toContain(
      "v_status := CASE WHEN NEW.status = 'lost' THEN 'dropped' ELSE 'active' END;"
    );
    expect(sync).toMatch(
      /IF NEW\.status = 'dropped' THEN[\s\S]*status = 'lost'/
    );
  });

  it('never bounces a change back across the link', () => {
    expect((sync.match(/pg_trigger_depth\(\) > 1/g) ?? []).length).toBe(3);
  });

  it('keeps a deal on another pipeline where it is', () => {
    expect(sync).toContain('AND pipeline_id = v_pipeline');
    expect(sync).toMatch(/IF v_js IS NULL THEN\s+v_js := v_from;/);
  });

  it('backfills the link for every earlier deal and aligns the branch', () => {
    expect(backfill).toContain("'Captured from deal'");
    expect(backfill).toContain('SET source_journey_item_id = ji.id');
    expect(backfill).toMatch(
      /SELECT 1 FROM deals other\s+WHERE other\.source_journey_item_id = ji\.id AND other\.id <> d\.id/
    );
    expect(backfill).toContain(
      "status = CASE WHEN l.deal_status = 'lost' THEN 'dropped' ELSE 'active' END"
    );
  });
});
