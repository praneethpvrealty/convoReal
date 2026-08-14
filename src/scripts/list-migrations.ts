/**
 * Prints every migration in the order it should be applied.
 *
 * Worth having because a plain `ls` does NOT show that order: the
 * sequential era is 3 digits and the timestamped era is 14, so string
 * sorting drops a 2026 stamp between 199 and 200. See
 * src/lib/migrations/numbering.ts.
 *
 * Usage:
 *   npm run migration:list              # all of them
 *   npm run migration:list -- --since=278   # everything after a version
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  compareMigrationVersions,
  migrationVersion,
  migrationsInApplyOrder,
} from '../lib/migrations/numbering';

const args = process.argv.slice(2);
const sinceArg = args.find((a) => a.startsWith('--since='));
const since = sinceArg ? sinceArg.slice('--since='.length).trim() : null;

const ordered = migrationsInApplyOrder(
  readdirSync(join(process.cwd(), 'supabase', 'migrations'))
);

let shown = ordered;
if (since) {
  // Compared by VERSION, not by filename: `--since=278` means
  // "everything a database already at 278 still owes", so 278 itself is
  // not in the list.
  const marker = migrationVersion(`${since}_x.sql`);
  if (!marker) {
    console.error(
      `--since must be a migration version, e.g. 278; got "${since}".`
    );
    process.exit(1);
  }
  shown = ordered.filter((name) => {
    const version = migrationVersion(name);
    return version !== null && compareMigrationVersions(version, marker) > 0;
  });
}

for (const name of shown) console.log(name);

if (shown.length === 0) {
  console.error(since ? `Nothing after ${since}.` : 'No migrations found.');
}
