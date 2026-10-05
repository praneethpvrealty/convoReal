import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');
const RESOLVERS = new Set([
  'lib/storage/url.ts',
  'lib/storage/url.test.ts',
  'lib/storage/no-image-transform.test.ts',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('Supabase image transformations', () => {
  it('are never requested, because each origin image is billed per cycle', () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => !RESOLVERS.has(relative(SRC, path)))
      .filter((path) => readFileSync(path, 'utf8').includes('/render/image/'))
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });
});
