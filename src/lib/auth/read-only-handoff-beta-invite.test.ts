import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrations = join(process.cwd(), 'supabase/migrations');
const file = '20261006035538_handoff_beta_invite_read_only.sql';
const migration = readFileSync(join(migrations, file), 'utf8');

const writeFunctions = [
  ['handoff_contact', 'v_caller_account_id', 'UPDATE contacts'],
  ['issue_beta_invite', 'v_account_id', 'INSERT INTO beta_invites'],
] as const;

const routes = [
  'src/app/api/contacts/[id]/handoff/route.ts',
  'src/app/api/beta-invites/route.ts',
] as const;

function definition(sql: string, name: string) {
  const start = sql.search(
    new RegExp(`CREATE (OR REPLACE )?FUNCTION (public\\.)?${name}\\(`)
  );
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf('\n$$;', start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe('[ACC-006] read-only members, contact handoff and beta invitations', () => {
  it.each(writeFunctions)(
    '%s refuses a read-only caller before it writes',
    (name, account, write) => {
      const body = definition(migration, name);
      expect(body).toContain('SECURITY DEFINER');
      const guard = body.search(
        new RegExp(
          `IF NOT is_account_writer\\(${account}, 'agent'\\) THEN\\s+RAISE EXCEPTION 'Read-only members cannot make changes\\.'\\s+USING ERRCODE = '42501';`
        )
      );
      expect(guard).toBeGreaterThan(-1);
      expect(body.indexOf(write)).toBeGreaterThan(guard);
    }
  );

  it('redefines exactly those functions', () => {
    const defined = [
      ...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g),
    ].map((m) => m[1]);
    expect(defined.sort()).toEqual(writeFunctions.map(([name]) => name).sort());
  });

  it('leaves the grants as they are', () => {
    expect(migration).not.toMatch(/\b(GRANT|REVOKE)\b/);
  });

  it.each(routes)('%s answers a read-only member with a 403', (route) => {
    const source = readFileSync(join(process.cwd(), route), 'utf8');
    expect(source).toContain("requireWriteRole('agent')");
    expect(source).not.toContain("requireRole('agent')");
  });

  it('is the latest definition of each function', () => {
    const later = readdirSync(migrations)
      .filter((name) => /^\d{14}_/.test(name) && name > file)
      .map((name) => readFileSync(join(migrations, name), 'utf8'));
    for (const [name] of writeFunctions) {
      const redefinition = new RegExp(
        `CREATE (OR REPLACE )?FUNCTION (public\\.)?${name}\\(`
      );
      for (const sql of later) {
        if (!redefinition.test(sql)) continue;
        expect(definition(sql, name)).toContain('is_account_writer(');
      }
    }
  });
});
