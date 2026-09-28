import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(process.cwd(), 'src', 'app');
const STREAMED_BY_DESIGN = new Set(['(showcase)/page.tsx']);

function pages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pages(full, out);
    else if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

function loadingAbove(page: string): string | null {
  let dir = dirname(page);
  while (dir.startsWith(APP)) {
    const loading = join(dir, 'loading.tsx');
    if (existsSync(loading)) return relative(APP, loading);
    if (dir === APP) break;
    dir = dirname(dir);
  }
  return null;
}

describe('public not-found pages send a real 404', () => {
  const notFoundPages = pages(APP).filter((page) =>
    readFileSync(page, 'utf8').includes('notFound()')
  );

  it('finds the pages that call notFound()', () => {
    const names = notFoundPages.map((page) =>
      relative(APP, page).split(sep).join('/')
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'property/[slug]/page.tsx',
        'projects/[project]/page.tsx',
        'farmland/[destination]/page.tsx',
        'articles/[slug]/page.tsx',
        'services/[service]/page.tsx',
        'property-consultants/[city]/page.tsx',
      ])
    );
  });

  it('[PRP-022] [SLP-003] [SLP-004] keeps every loading boundary off the path of a page that calls notFound()', () => {
    const streamed = notFoundPages
      .map((page) => ({
        page: relative(APP, page).split(sep).join('/'),
        loading: loadingAbove(page),
      }))
      .filter(({ page, loading }) => loading && !STREAMED_BY_DESIGN.has(page));
    expect(streamed).toEqual([]);
  });

  it('[PRP-022] leaves the seller route outside the showcase skeleton', () => {
    expect(loadingAbove(join(APP, 'seller', '[slug]', 'page.tsx'))).toBeNull();
    expect(existsSync(join(APP, 'loading.tsx'))).toBe(false);
    for (const group of [
      '(showcase)',
      '(auth)',
      '(dashboard)',
      '(den)',
      '(buyer)',
    ]) {
      expect(existsSync(join(APP, group, 'loading.tsx'))).toBe(true);
    }
  });
});
