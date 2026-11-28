import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = join(process.cwd(), 'supabase/migrations');
const before = readFileSync(
  join(MIGRATIONS, '162_org_coordinator_policies.sql'),
  'utf8'
);
const after = readFileSync(
  join(MIGRATIONS, '20261128043424_contacts_select_member_initplan.sql'),
  'utf8'
);

const squash = (sql: string) =>
  sql
    .replace(/--.*$/gm, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();

function between(sql: string, start: string, end: string): string {
  const from = sql.indexOf(start);
  if (from < 0) throw new Error(`missing ${start}`);
  const to = sql.indexOf(end, from + start.length);
  if (to < 0) throw new Error(`missing ${end} after ${start}`);
  return sql.slice(from + start.length, to);
}

const roleRanking = (fn: string) => {
  const ranking = fn.match(
    /CASE min_role[\s\S]*?END\s*<=\s*CASE p\.org_role[\s\S]*?END/
  );
  if (!ranking) throw new Error('missing role ranking');
  return squash(ranking[0]);
};

describe('[ACC-013] contacts_select resolves membership once per statement', () => {
  const oldPolicy = squash(
    between(
      before,
      'CREATE POLICY contacts_select ON contacts FOR SELECT USING (',
      'DROP POLICY IF EXISTS contacts_update'
    )
  ).replace(/\);$/, '');
  const newPolicy = squash(
    after
      .slice(after.indexOf('ALTER POLICY contacts_select ON contacts'))
      .replace('ALTER POLICY contacts_select ON contacts', '')
      .replace(/^\s*USING \(/, '')
      .replace(/\);\s*$/, '')
  );

  it('keeps every visibility branch and changes only how membership and auth.uid() are read', () => {
    const expected = oldPolicy
      .replace(
        'is_account_member(account_id)',
        'account_id IN (SELECT public.member_account_ids())'
      )
      .replaceAll('auth.uid()', '(SELECT auth.uid())');
    expect(newPolicy).toBe(expected);
  });

  it('no longer calls is_account_member() per contact row', () => {
    expect(newPolicy).not.toContain('is_account_member(');
    expect(newPolicy).not.toMatch(/(?<!SELECT )auth\.uid\(\)/);
  });

  it('ranks roles in member_account_ids() exactly as is_account_member() does', () => {
    const helper = between(
      after,
      'CREATE OR REPLACE FUNCTION public.member_account_ids(',
      'REVOKE ALL'
    );
    const original = between(
      before,
      'CREATE OR REPLACE FUNCTION is_account_member(',
      '$$;'
    );
    expect(roleRanking(helper)).toBe(roleRanking(original));
    expect(squash(helper)).toContain('WHERE p.user_id = auth.uid()');
    expect(squash(helper)).toContain(
      'SECURITY DEFINER SET search_path = public'
    );
    expect(squash(helper)).toContain(
      "min_role account_role_enum DEFAULT 'viewer'"
    );
  });

  it('alters the policy in place and leaves the write policies alone', () => {
    expect(after).not.toMatch(/DROP\s+POLICY/i);
    expect(after.match(/ALTER POLICY (\w+)/g)).toEqual([
      'ALTER POLICY contacts_select',
    ]);
  });
});
