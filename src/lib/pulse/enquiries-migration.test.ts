import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PULSE_ENQUIRY_KINDS } from './enquiries';

const migration = readFileSync(
  resolve(
    __dirname,
    '../../../supabase/migrations/20261109101500_pulse_enquiries.sql'
  ),
  'utf8'
);

describe('[PLS-009] pulse_enquiries feeds every kind the panel lists, behind the member guard', () => {
  it('unions every kind the shared module knows and nothing it does not', () => {
    for (const kind of PULSE_ENQUIRY_KINDS) {
      expect(migration).toContain(`'${kind}'`);
    }
    const kindsInSql = [
      ...migration.matchAll(
        /SELECT 'enquiry'::TEXT AS kind, count|^\s+SELECT '([a-z_]+)', count/gm
      ),
    ];
    expect(kindsInSql.length).toBeGreaterThanOrEqual(
      PULSE_ENQUIRY_KINDS.length - 1
    );
  });

  it('guards both functions with is_account_member and grants them to signed-in members only', () => {
    expect(
      (migration.match(/is_account_member\(p_account_id\)/g) ?? []).length
    ).toBe(2);
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.pulse_enquiries\([^)]*\) TO authenticated/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.pulse_enquiry_counts\([^)]*\) TO authenticated/
    );
    expect(migration).not.toMatch(/TO anon/);
  });

  it('pages newest first by (occurred_at, id) and caps a page at 100 rows', () => {
    expect(migration).toContain('ORDER BY r.occurred_at DESC, r.id DESC');
    expect(migration).toContain('p_before_id UUID DEFAULT NULL');
    expect(migration).toContain(
      '(r.occurred_at, r.id) < (p_before, p_before_id)'
    );
    expect(migration).toContain('LIMIT LEAST(GREATEST(p_limit, 1), 100)');
  });

  it('shows a contact\u2019s identity only to a caller contacts_select would let see it', () => {
    const join = migration.slice(
      migration.indexOf('LEFT JOIN contacts c'),
      migration.indexOf('LEFT JOIN properties p')
    );
    expect(join).toContain(
      "profile.org_role IN ('org_manager', 'org_coordinator')"
    );
    expect(join).toContain('c.assigned_agent_id = (SELECT auth.uid())');
    expect(join).toContain('c.assigned_team_id = (');
    expect(join).toContain("profile.org_role IN ('org_manager', 'org_leader')");
    expect(migration).toContain('c.id AS contact_id');
  });
});
