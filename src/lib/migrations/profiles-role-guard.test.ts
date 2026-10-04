import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261004080500_profiles_privileged_columns_guard.sql'
  ),
  'utf8'
);

describe('profile role columns are not self-service', () => {
  it('[ACC-001] a signed-in client cannot move its own account, role, team, platform role or read-only flag', () => {
    expect(sql).toContain("current_user IN ('authenticated', 'anon')");
    for (const column of [
      'account_id',
      'account_role',
      'org_role',
      'is_read_only',
      'team_id',
      'role',
    ]) {
      expect(sql).toContain(`NEW.${column} IS DISTINCT FROM OLD.${column}`);
    }
    expect(sql).toContain("USING ERRCODE = '42501'");
    expect(sql).toMatch(
      /BEFORE UPDATE OF account_id, account_role, org_role, is_read_only, team_id, role ON profiles/
    );
  });

  it('[ACC-001] the member RPCs and the service role keep writing those columns', () => {
    expect(sql).not.toMatch(/auth\.role\(\)/);
    expect(sql).not.toMatch(/SECURITY DEFINER/);
    expect(sql).toContain('RETURN NEW;');
  });
});
