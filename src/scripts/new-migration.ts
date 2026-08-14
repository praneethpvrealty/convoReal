/**
 * Creates a migration file with a UTC timestamp for a version, so two
 * branches open at the same time cannot collide on it.
 *
 * Usage:
 *   npm run migration:new -- "add reminder audio"
 *   npm run migration:new -- --table=liaison_notes "liaison notes"
 *
 * `--table=<name>` scaffolds the operational-table boilerplate every
 * new table owes: account_id, the updated_at trigger, RLS, and the
 * is_account_member policies (AGENTS.md §7.2). Without it you get an
 * empty file with the header and nothing assumed about what you are
 * writing.
 *
 * Reads and writes nothing but the migrations directory.
 */

import { writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

const args = process.argv.slice(2);
const tableArg = args.find((a) => a.startsWith('--table='));
const table = tableArg ? tableArg.slice('--table='.length).trim() : null;
const description = args
  .filter((a) => !a.startsWith('--'))
  .join(' ')
  .trim();

if (!description) {
  console.error(
    'Usage: npm run migration:new -- "what it does" [--table=name]'
  );
  process.exit(1);
}

if (table && !/^[a-z][a-z0-9_]*$/.test(table)) {
  console.error(
    `--table must be a lower_snake_case identifier; got "${table}".`
  );
  process.exit(1);
}

/** `YYYYMMDDHHMMSS` in UTC — the shape isTimestampPrefix() accepts and
 *  the one the Supabase CLI generates, so adopting it later is a no-op. */
function utcStamp(now: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return [
    pad(now.getUTCFullYear(), 4),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join('');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

const slug = slugify(description);
if (!slug) {
  console.error('That description has no letters or digits in it.');
  process.exit(1);
}

// A second's resolution is enough between branches, but two files made
// in the same second on one machine would collide — step forward until
// the name is free rather than overwriting.
let stamp = utcStamp(new Date());
const taken = new Set(readdirSync(MIGRATIONS_DIR));
const isTaken = (s: string) =>
  [...taken].some((name) => name.startsWith(`${s}_`));
while (isTaken(stamp)) {
  stamp = utcStamp(new Date(Date.parse(isoFromStamp(stamp)) + 1000));
}

function isoFromStamp(s: string): string {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(
    8,
    10
  )}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
}

const filename = `${stamp}_${slug}.sql`;
const header = [
  '-- ============================================================',
  `-- ${filename} — ${description}`,
  '--',
  '-- Say why this exists, not what the SQL says.',
  '-- ============================================================',
  '',
  '',
].join('\n');

const tableBody = table
  ? [
      `CREATE TABLE IF NOT EXISTS ${table} (`,
      '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
      '  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,',
      '  created_at TIMESTAMPTZ DEFAULT NOW(),',
      '  updated_at TIMESTAMPTZ DEFAULT NOW()',
      ');',
      '',
      `CREATE INDEX IF NOT EXISTS idx_${table}_account_id ON ${table}(account_id);`,
      '',
      `DROP TRIGGER IF EXISTS set_updated_at ON ${table};`,
      `CREATE TRIGGER set_updated_at BEFORE UPDATE ON ${table}`,
      '  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();',
      '',
      `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
      '',
      `DROP POLICY IF EXISTS "${table}_select" ON ${table};`,
      `CREATE POLICY "${table}_select" ON ${table}`,
      '  FOR SELECT USING (is_account_member(account_id));',
      '',
      `DROP POLICY IF EXISTS "${table}_write" ON ${table};`,
      `CREATE POLICY "${table}_write" ON ${table}`,
      "  FOR ALL USING (is_account_member(account_id, 'agent'))",
      "  WITH CHECK (is_account_member(account_id, 'agent'));",
      '',
    ].join('\n')
  : '';

writeFileSync(join(MIGRATIONS_DIR, filename), `${header}${tableBody}`, {
  flag: 'wx',
});

console.log(`supabase/migrations/${filename}`);
if (table) {
  console.log(
    `Scaffolded ${table} with account_id, the updated_at trigger, RLS and is_account_member policies. Check them before you run it.`
  );
}
console.log(
  'Name this file in the CHANGELOG entry — that is how self-hosters know to apply it.'
);
