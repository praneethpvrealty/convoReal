import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// journey_items carries two foreign keys to journey_stages (stage_id and
// planned_stage_id), so PostgREST refuses `stage:journey_stages(...)`
// with "more than one relationship was found" unless the embed names
// the key. The conversion route shipped that way and failed in
// production the first time a journey move opened a deal.

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
      out.push(full);
  }
  return out;
}

describe('[TXW-018] every journey_stages embed names its foreign key', () => {
  it('never embeds journey_stages from journey_items without the stage_id hint', () => {
    const offenders: string[] = [];
    for (const file of [
      ...walk(join(process.cwd(), 'src')),
      ...walk(join(process.cwd(), 'mobile', 'lib')),
      ...walk(join(process.cwd(), 'mobile', 'app')),
    ]) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\w+:journey_stages\(/g)) {
        offenders.push(`${file.replace(process.cwd() + '/', '')}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
