import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260929062349_add_journey_item_note.sql'
  ),
  'utf8'
);

describe('add_journey_item_note', () => {
  it('[JRN-004] tags the note with the item’s current stage in one locked statement', () => {
    expect(sql).toContain('INSERT INTO journey_stage_notes (');
    expect(sql).toContain('ON js.id = ji.stage_id');
    expect(sql).toContain('AND ji.account_id = p_account_id');
    expect(sql).toContain('FOR SHARE OF ji');
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).toContain('SET search_path = public');
    expect(sql).toContain('TO authenticated;');
  });
});
