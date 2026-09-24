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
/** Not source, or not ours. `@/*` matches the whole mobile root, so
 *  everything else is scanned rather than a hand-picked list. */
const SKIP = new Set([
  'node_modules',
  '.expo',
  '.git',
  'dist',
  'build',
  'ios',
  'android',
]);

/** Module specifiers a mobile file can be imported by as `@/<spec>`,
 *  with `x/index` normalized to `x` the way TypeScript resolves it. */
function modulePaths(root: string, dir = '', out: string[] = []): string[] {
  const full = dir ? join(root, dir) : root;
  if (!existsSync(full)) return out;
  for (const entry of readdirSync(full)) {
    if (SKIP.has(entry)) continue;
    const rel = dir ? `${dir}/${entry}` : entry;
    if (statSync(join(root, rel)).isDirectory()) {
      modulePaths(root, rel, out);
    } else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(rel.replace(/\.tsx?$/, '').replace(/\/index$/, ''));
    }
  }
  return out;
}

/** Every file TypeScript would try for `@/<spec>`, index included. */
function resolves(root: string, spec: string): boolean {
  return ['.ts', '.tsx', '/index.ts', '/index.tsx'].some((ext) =>
    existsSync(join(root, spec + ext))
  );
}

describe('the mobile @/ alias', () => {
  it('[ALS-001] has no module path that also exists under src/', () => {
    const shadowed = modulePaths(MOBILE_ROOT).filter((spec) =>
      resolves(SRC_ROOT, spec)
    );
    expect(
      shadowed,
      `these mobile modules shadow a web module of the same path for every ` +
        `web file in this program that imports it as "@/<path>": ` +
        `${shadowed.join(', ')}. Rename the mobile one.`
    ).toEqual([]);
  });

  it('[ALS-001] scans the whole root and resolves index modules', () => {
    const specs = modulePaths(MOBILE_ROOT);
    expect(specs.length).toBeGreaterThan(200);
    expect(specs).toContain('lib/contact-languages');
    // A directory index is named by its parent, so a mobile `types.ts`
    // would shadow src/types/index.ts and has to compare equal to it.
    expect(specs.some((s) => s.endsWith('/index'))).toBe(false);
    expect(resolves(SRC_ROOT, 'types')).toBe(true);
  });
});
