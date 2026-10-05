import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = join(process.cwd(), 'supabase/migrations');
const FILE = '20261005083357_workspace_write_read_only_rls.sql';
const migration = readFileSync(join(MIGRATIONS, FILE), 'utf8');

interface PolicyStatement {
  file: string;
  name: string;
  table: string;
  command: string;
  body: string;
}

function policies(sql: string, file: string): PolicyStatement[] {
  const found: PolicyStatement[] = [];
  const pattern =
    /CREATE POLICY\s+("[^"]+"|\w+)\s+ON\s+(?:public\.)?(\w+)([\s\S]*?);/gi;
  for (const match of sql.matchAll(pattern)) {
    const rest = match[3];
    found.push({
      file,
      name: match[1].replace(/"/g, ''),
      table: match[2],
      command: (/\bFOR\s+(\w+)/i.exec(rest)?.[1] ?? 'ALL').toUpperCase(),
      body: rest,
    });
  }
  return found;
}

const refusesReadOnly = (body: string) =>
  /is_account_writer\(|is_read_only/.test(body);

const own = policies(migration, FILE);
const writes = own.filter((p) => p.command !== 'SELECT');

const readOnlyMayWrite = [
  ['agent_task_digest_settings', 'agent_task_digest_settings_own'],
  ['notification_devices', 'notification_devices_insert'],
  ['support_tickets', 'support_tickets_insert'],
  ['bug_reports', 'bug_reports_insert'],
] as const;

const laterMigrationExemptions = new Set<string>();

describe('[ACC-003] read-only RLS on every workspace write policy', () => {
  it('moves every write policy it recreates off is_account_member', () => {
    expect(writes.length).toBe(169);
    for (const policy of writes) {
      expect(
        refusesReadOnly(policy.body),
        `${policy.table}.${policy.name}`
      ).toBe(true);
      expect(policy.body, `${policy.table}.${policy.name}`).not.toContain(
        'is_account_member('
      );
    }
  });

  it('drops each policy before recreating it so it can be re-run', () => {
    for (const policy of own) {
      const name = /^[a-z_][a-z0-9_]*$/.test(policy.name)
        ? policy.name
        : `"${policy.name}"`;
      expect(migration).toContain(
        `DROP POLICY IF EXISTS ${name} ON ${policy.table};`
      );
    }
  });

  it.each([
    'contacts',
    'properties',
    'deals',
    'conversations',
    'messages',
    'todos',
    'broadcasts',
    'pipelines',
    'tags',
    'whatsapp_config',
    'message_templates',
    'subscriptions',
    'portal_accounts',
    'razorpay_orders',
  ])('covers %s', (table) => {
    expect(writes.some((p) => p.table === table)).toBe(true);
  });

  it.each(readOnlyMayWrite)(
    'leaves %s.%s open to a read-only member',
    (table, name) => {
      expect(own.some((p) => p.table === table && p.name === name)).toBe(false);
    }
  );

  it('keeps reads open where the tightened FOR ALL policy was the only read path', () => {
    const selects = own.filter((p) => p.command === 'SELECT');
    expect(selects.map((p) => p.table).sort()).toEqual([
      'contact_property_inquiries',
      'portal_accounts',
      'portal_import_items',
    ]);
    for (const policy of selects) {
      expect(policy.body).not.toContain('is_account_writer(');
      expect(policy.body).not.toContain('is_read_only');
    }
  });

  it('lets a team leader edit their team only while they can write', () => {
    const teams = writes.find((p) => p.name === 'teams_update');
    expect(teams?.body).toMatch(
      /leader_id = auth\.uid\(\) AND is_account_writer\(account_id, 'agent'\)/
    );
  });

  it('holds every later migration to the same rule', () => {
    const later = readdirSync(MIGRATIONS)
      .filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > FILE)
      .flatMap((f) => policies(readFileSync(join(MIGRATIONS, f), 'utf8'), f));
    const offenders = later
      .filter((p) => p.command !== 'SELECT')
      .filter((p) => p.body.includes('is_account_member('))
      .filter((p) => !refusesReadOnly(p.body))
      .map((p) => `${p.file}: ${p.table}.${p.name}`)
      .filter((id) => !laterMigrationExemptions.has(id));
    expect(offenders).toEqual([]);
  });
});
