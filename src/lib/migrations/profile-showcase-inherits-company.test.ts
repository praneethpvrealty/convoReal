import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATION = join(
  process.cwd(),
  'supabase/migrations/20260927094500_profile_showcase_inherits_company.sql'
);

describe('[PRP-021] a new member follows the company showcase design', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('stops new profiles defaulting to a personal design', () => {
    for (const column of ['showcase_style', 'showcase_3d_enabled']) {
      expect(sql).toContain(`ALTER COLUMN ${column} DROP DEFAULT`);
      expect(sql).toContain(`ALTER COLUMN ${column} DROP NOT NULL`);
    }
  });

  it('clears the personal design whenever a profile moves to another account', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER profiles_showcase_follows_new_account\s+BEFORE UPDATE OF account_id ON public\.profiles\s+FOR EACH ROW\s+WHEN \(OLD\.account_id IS DISTINCT FROM NEW\.account_id\)/
    );
    expect(sql).toContain('NEW.showcase_style := NULL;');
    expect(sql).toContain('NEW.showcase_3d_enabled := NULL;');
  });
});
