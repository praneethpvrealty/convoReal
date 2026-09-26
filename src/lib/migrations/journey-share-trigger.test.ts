import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATION = join(
  process.cwd(),
  'supabase/migrations/20260926121500_journey_capture_share_trigger.sql'
);

describe('[JRN-009] the share ledger captures the journey itself', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('fires after every ledger insert and reads the visibility off the row', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER journey_capture_from_share_trigger\s+AFTER INSERT ON property_shares\s+FOR EACH ROW EXECUTE FUNCTION journey_capture_from_share\(\)/
    );
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS journey_visible BOOLEAN NOT NULL DEFAULT FALSE'
    );
    expect(sql).toContain("'whatsapp_share', NOT NEW.journey_visible");
  });

  it('never resurrects, un-hides or duplicates a pair already on the journey', () => {
    expect(sql).toContain(
      'ON CONFLICT (account_id, contact_id, property_id) DO NOTHING'
    );
    expect(sql).toMatch(
      /IF v_item IS NOT NULL THEN\s+INSERT INTO journey_events/
    );
  });

  it('never lets a journey failure block the ledger write', () => {
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN[\s\S]*RETURN NEW;/);
  });
});
