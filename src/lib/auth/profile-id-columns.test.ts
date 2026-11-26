import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === 'route.ts' ? [path] : [];
  });
}

describe('columns that reference profiles(id)', () => {
  it('are written with the caller profile id, never auth.uid()', () => {
    const offenders = routeFiles(join(process.cwd(), 'src/app/api')).filter(
      (file) => {
        const source = readFileSync(file, 'utf8');
        if (/\b(created_by|uploaded_by):\s*ctx\.userId\b/.test(source)) {
          return /invoice|deals\/\[id\]\/documents/.test(file);
        }
        return (
          /invoice/.test(file) && /\bactorId:\s*ctx\.userId\b/.test(source)
        );
      }
    );
    expect(offenders).toEqual([]);
  });
});
