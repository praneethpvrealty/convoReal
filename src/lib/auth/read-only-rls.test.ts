import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261004155516_flow_automation_write_read_only_rls.sql'
  ),
  'utf8'
);

const writePolicies = [
  ['flows', 'flows_insert'],
  ['flows', 'flows_update'],
  ['flows', 'flows_delete'],
  ['flow_nodes', 'flow_nodes_modify'],
  ['automations', 'automations_insert'],
  ['automations', 'automations_update'],
  ['automations', 'automations_delete'],
  ['automation_steps', 'automation_steps_modify'],
] as const;

function policy(table: string, name: string) {
  const start = migration.indexOf(`CREATE POLICY ${name} ON ${table} `);
  expect(start).toBeGreaterThan(-1);
  return migration.slice(start, migration.indexOf(';', start));
}

describe('read-only RLS on flows and automations', () => {
  it('defines is_account_writer as membership that refuses read-only members', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.is_account_writer\([\s\S]*?SECURITY DEFINER[\s\S]*?is_account_member\(target_account_id, min_role\)[\s\S]*?AND p\.is_read_only/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.is_account_writer\(UUID, account_role_enum\) FROM PUBLIC, anon;/
    );
  });

  it.each(writePolicies)(
    '%s.%s is dropped and recreated on is_account_writer',
    (table, name) => {
      expect(migration).toContain(`DROP POLICY IF EXISTS ${name} ON ${table};`);
      const body = policy(table, name);
      expect(body).toContain('is_account_writer(');
      expect(body).not.toContain('is_account_member(');
    }
  );

  it('leaves the read policies alone', () => {
    expect(migration).not.toMatch(/_select ON/);
  });
});
