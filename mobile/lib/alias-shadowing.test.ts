import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `@/*` in tsconfig.json resolves against the mobile root first and
 * ../src second, and that list applies to every file in the program —
 * including the web modules @shared/ pulls in. A mobile module sitting
 * at a path a web module imports as `@/<path>` therefore shadows the
 * web one for that import, silently, with no error at the import site.
 *
 * So the two roots must not overlap. The same case lives in
 * src/lib/mobile-parity.test.ts because each CI job only sees its own
 * half of a diff: this one catches a mobile file added over a web path,
 * that one catches a web file added under a mobile path.
 */

const MOBILE_ROOT = join(__dirname, '..');
const SRC_ROOT = join(MOBILE_ROOT, '..', 'src');
/** The directories a mobile `@/<path>` can name. */
const ALIASED = ['lib', 'components', 'app', 'hooks', 'types'];
const SKIP = new Set(['node_modules', '.expo', 'dist', 'ios', 'android']);

function modulePaths(root: string, dir: string, out: string[] = []): string[] {
  const full = join(root, dir);
  if (!existsSync(full)) return out;
  for (const entry of readdirSync(full)) {
    if (SKIP.has(entry)) continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) {
      modulePaths(root, rel, out);
    } else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(rel.replace(/\.tsx?$/, ''));
    }
  }
  return out;
}

describe('the mobile @/ alias', () => {
  it('[ALS-001] has no module path that also exists under src/', () => {
    const shadowed = ALIASED.flatMap((dir) =>
      modulePaths(MOBILE_ROOT, dir).filter((spec) =>
        ['.ts', '.tsx'].some((ext) => existsSync(join(SRC_ROOT, spec + ext)))
      )
    );
    expect(
      shadowed,
      `these mobile modules shadow a web module of the same path for every ` +
        `web file in this program that imports it as "@/<path>": ` +
        `${shadowed.join(', ')}. Rename the mobile one.`
    ).toEqual([]);
  });

  it('[ALS-001] scans a directory that actually holds modules', () => {
    expect(modulePaths(MOBILE_ROOT, 'lib').length).toBeGreaterThan(50);
    expect(modulePaths(MOBILE_ROOT, 'lib')).toContain('lib/contact-languages');
  });
});
