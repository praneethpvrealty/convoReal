import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrations = join(root, 'supabase/migrations');
const file = '20261007081838_member_management_read_only.sql';
const migration = readFileSync(join(migrations, file), 'utf8');

const writeFunctions = [
  ['set_member_role', 'UPDATE profiles'],
  ['set_member_org_role', 'UPDATE profiles'],
  ['set_member_team', 'UPDATE profiles'],
  ['remove_account_member', 'INSERT INTO accounts'],
  ['transfer_account_ownership', 'UPDATE profiles'],
] as const;

const routes = [
  [
    'src/app/api/account/members/[userId]/route.ts',
    "requireWriteRole('admin')",
  ],
  [
    'src/app/api/account/transfer-ownership/route.ts',
    "requireWriteRole('owner')",
  ],
  ['src/app/api/account/members/[userId]/team/route.ts', 'ctx.isReadOnly'],
  ['src/app/api/account/members/[userId]/org-role/route.ts', 'ctx.isReadOnly'],
  ['src/app/api/account/delete/route.ts', 'ctx.isReadOnly'],
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

describe('[ACC-007] read-only members and member management', () => {
  it.each(writeFunctions)(
    '%s refuses a read-only caller before it writes',
    (name, write) => {
      const body = definition(migration, name);
      expect(body).toContain('SECURITY DEFINER');
      const guard = body.search(
        /IF NOT is_account_writer\(v_caller_account_id, 'agent'\) THEN\s+RAISE EXCEPTION 'Read-only members cannot make changes\.'\s+USING ERRCODE = '42501';/
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

  it('keeps mark_bot_instructions_fired for the service role only', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.mark_bot_instructions_fired(UUID, UUID[]) FROM PUBLIC, anon, authenticated;'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.mark_bot_instructions_fired(UUID, UUID[]) TO service_role;'
    );
    const caller = readFileSync(
      join(root, 'src/lib/whatsapp/inbound/chain/steps/lead-question.ts'),
      'utf8'
    );
    expect(caller).toMatch(/markBotInstructionsFired\(\s+admin,/);
  });

  it.each(routes)(
    '%s answers a read-only member with a 403',
    (route, check) => {
      const source = readFileSync(join(root, route), 'utf8');
      expect(source).toContain(check);
      expect(source).not.toMatch(/\brequireRole\(/);
    }
  );

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
