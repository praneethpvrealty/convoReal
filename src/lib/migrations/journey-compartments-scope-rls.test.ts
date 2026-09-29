import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260929054500_journey_compartments_scope_rls.sql'
  ),
  'utf8'
);

describe('journey compartments RLS follows the account scope', () => {
  it('[JRN-014] reads and writes only rows of the scope in force', () => {
    expect(sql).toContain("WHEN a.journey_compartment_scope = 'agent'");
    expect(sql).toContain(
      'THEN p_user_id IS NOT NULL AND p_user_id = auth.uid()'
    );
    expect(sql).toContain('ELSE p_user_id IS NULL');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public');
    for (const action of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      expect(sql).toMatch(
        new RegExp(`FOR ${action} (USING|WITH CHECK) \\(\\s*is_account_member`)
      );
    }
    expect(
      sql.match(/journey_compartment_row_in_scope\(account_id, user_id\)/g)
    ).toHaveLength(5);
    expect(sql).not.toContain('user_id IS NULL OR user_id = auth.uid()');
  });
});
