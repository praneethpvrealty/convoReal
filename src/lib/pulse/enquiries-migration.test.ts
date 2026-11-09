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

  it('pages newest first by occurred_at then id and caps a page at 100 rows', () => {
    expect(migration).toContain('ORDER BY r.occurred_at DESC, r.id DESC');
    expect(migration).toContain('p_before IS NULL OR r.occurred_at < p_before');
    expect(migration).toContain('LIMIT LEAST(GREATEST(p_limit, 1), 100)');
  });
});
