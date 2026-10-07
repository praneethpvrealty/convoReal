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
  altered: boolean;
  body: string;
}

const POLICY_PATTERN =
  /(CREATE|ALTER) POLICY\s+("[^"]+"|\w+)\s+ON\s+(?:public\.)?(\w+)([\s\S]*?);/gi;

const createdCommand = new Map<string, string>();
for (const file of readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
  for (const match of sql.matchAll(POLICY_PATTERN)) {
    if (match[1].toUpperCase() !== 'CREATE') continue;
    createdCommand.set(
      `${match[3]}.${match[2].replace(/"/g, '')}`,
      (/\bFOR\s+(\w+)/i.exec(match[4])?.[1] ?? 'ALL').toUpperCase()
    );
  }
}

function policies(sql: string, file: string): PolicyStatement[] {
  const found: PolicyStatement[] = [];
  for (const match of sql.matchAll(POLICY_PATTERN)) {
    const rest = match[4];
    const name = match[2].replace(/"/g, '');
    const altered = match[1].toUpperCase() === 'ALTER';
    found.push({
      file,
      name,
      table: match[3],
      command: altered
        ? (createdCommand.get(`${match[3]}.${name}`) ?? 'ALL')
        : (/\bFOR\s+(\w+)/i.exec(rest)?.[1] ?? 'ALL').toUpperCase(),
      altered,
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

  it('alters each write policy in place so it can be re-run', () => {
    expect(migration).not.toMatch(/\bDROP POLICY\b/i);
    for (const policy of writes) {
      expect(policy.altered, `${policy.table}.${policy.name}`).toBe(true);
    }
  });

  it('creates each added read policy only when it is missing', () => {
    for (const policy of own.filter((p) => p.command === 'SELECT')) {
      expect(migration).toContain(
        `tablename = '${policy.table}' AND policyname = '${policy.name}'`
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

  it('holds listing media, property documents and flow media in storage to the same rule', () => {
    const storage = readFileSync(
      join(MIGRATIONS, '20261007054244_property_storage_write_read_only.sql'),
      'utf8'
    );
    const written = [
      ...storage.matchAll(
        /(?:ALTER|CREATE) POLICY "([^"]+)" ON storage\.objects\b([\s\S]*?);/g
      ),
    ];
    expect([...new Set(written.map((m) => m[1]))].sort()).toEqual([
      'Agents can delete private property images',
      'Agents can delete property images',
      'Agents can update private property images',
      'Agents can update property images',
      'Agents can upload private property images',
      'Agents can upload property images',
      'Members can delete flow media',
      'Members can update flow media',
      'Members can upload flow media',
      'Users can delete property documents',
      'Users can delete their own flow media',
      'Users can update property documents',
      'Users can update their own flow media',
      'Users can upload property documents',
      'Users can upload their own flow media',
    ]);
    expect(storage).not.toMatch(/\b(DROP|RENAME)\b/);
    for (const [, name, body] of written) {
      expect(body, name).not.toContain('is_account_member(');
      if (name.includes('flow media')) {
        expect(body, name).toMatch(
          /\('account-' \|\| p\.account_id::text\) = \(storage\.foldername\(name\)\)\[1\]\s+AND public\.is_account_writer\(p\.account_id, 'agent'\)/
        );
        expect(body, name).not.toContain('auth.uid()::text');
      } else {
        expect(body, name).toMatch(
          /bucket_id = 'property-(images|images-private|documents)'\s+AND public\.is_account_writer\(\(\(storage\.foldername\(name\)\)\[1\]\)::uuid, 'agent'\)/
        );
      }
    }
  });

  it('only alters a policy no migration creates once it is known to exist', () => {
    for (const name of [
      'Owners can update own account',
      'pending_contact_updates_modify',
    ]) {
      expect(migration).toContain(`AND policyname = '${name}'\n  ) THEN`);
    }
  });

  it('reads the command of an altered policy from the migration that created it', () => {
    const [select] = policies(
      'ALTER POLICY contacts_select ON contacts USING (is_account_member(account_id));',
      'later.sql'
    );
    expect(select.command).toBe('SELECT');
    const [write] = policies(
      "ALTER POLICY contacts_update ON contacts USING (is_account_writer(account_id, 'agent'));",
      'later.sql'
    );
    expect(write.command).toBe('UPDATE');
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
