import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261004073500_portal_listings_write_role.sql'
  ),
  'utf8'
);

describe('portal listings are written by agents and above only', () => {
  it('[PRP-040] members read; insert, update and delete need the agent role', () => {
    expect(sql).toContain(
      'DROP POLICY IF EXISTS "Members manage own account portal listings"'
    );
    expect(sql).toMatch(
      /FOR SELECT USING \(\s*is_account_member\(account_id\)\s*\)/
    );
    for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
      expect(sql).toMatch(
        new RegExp(
          `FOR ${action} (USING|WITH CHECK) \\(\\s*is_account_member\\(account_id, 'agent'\\)`
        )
      );
    }
    expect(sql).toMatch(
      /FOR UPDATE USING \([\s\S]*?\) WITH CHECK \(\s*is_account_member\(account_id, 'agent'\)/
    );
    expect(sql).not.toMatch(/FOR ALL/);
    expect(sql.match(/p\.is_read_only IS NOT TRUE/g)).toHaveLength(4);
    expect(
      sql.match(/p\.account_id = property_portal_listings\.account_id/g)
    ).toHaveLength(4);
  });

  it('[PRP-040] a viewer folded into org_agent with is_read_only still cannot write', () => {
    for (const block of sql.split('DROP POLICY IF EXISTS').slice(2)) {
      if (block.includes('FOR SELECT')) continue;
      expect(block).toContain("is_account_member(account_id, 'agent')");
      expect(block).toContain('p.is_read_only IS NOT TRUE');
    }
  });
});
