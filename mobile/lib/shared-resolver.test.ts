import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createSharedResolver } from '../shared-resolver';

const projectRoot = '/repo/mobile';
const sharedRoot = '/repo/src';

interface FakeContext {
  originModulePath: string;
  resolveRequest: (
    ctx: FakeContext,
    name: string,
    platform: string | null
  ) => { type: 'sourceFile'; filePath: string };
}

/** Stands in for Expo's resolver chain: relative and absolute specifiers
 *  land on a .ts file, `@/x` falls back to src/ the way tsconfig's
 *  `@/*` list does, and packages resolve beside the origin. */
function context(originModulePath: string): FakeContext {
  return {
    originModulePath,
    resolveRequest(ctx, name) {
      if (name.startsWith('/'))
        return { type: 'sourceFile', filePath: `${name}.ts` };
      if (name.startsWith('.')) {
        return {
          type: 'sourceFile',
          filePath: `${resolve(dirname(ctx.originModulePath), name)}.ts`,
        };
      }
      if (name.startsWith('@/')) {
        return {
          type: 'sourceFile',
          filePath: `${join(sharedRoot, name.slice(2))}.ts`,
        };
      }
      return {
        type: 'sourceFile',
        filePath: join(
          dirname(ctx.originModulePath),
          'node_modules',
          name,
          'index.js'
        ),
      };
    },
  };
}

const resolveRequest = createSharedResolver({ projectRoot, sharedRoot });
const fromMobile = context(`${projectRoot}/lib/calendar-tasks.ts`);
const fromShared = context(`${sharedRoot}/lib/calendar/archive-sort.ts`);

describe('the @shared/ Metro resolver', () => {
  it('[SHR-001] maps @shared/* onto ../src/*', () => {
    expect(
      resolveRequest(fromMobile, '@shared/lib/calendar/archive-sort', 'android')
    ).toEqual({
      type: 'sourceFile',
      filePath: `${sharedRoot}/lib/calendar/archive-sort.ts`,
    });
  });

  it('[SHR-001] lets a shared module import its siblings by relative path', () => {
    expect(resolveRequest(fromShared, './deal-dates', 'android')).toEqual({
      type: 'sourceFile',
      filePath: `${sharedRoot}/lib/calendar/deal-dates.ts`,
    });
  });

  it('[SHR-002] refuses any package, alias or built-in a shared module imports', () => {
    for (const name of [
      'next/server',
      '@supabase/ssr',
      'server-only',
      'date-fns',
      'node:crypto',
      '@/lib/supabase/server',
    ]) {
      expect(() => resolveRequest(fromShared, name, 'android')).toThrow(
        /may only import other files under src\/ by relative path/
      );
    }
  });

  it('[SHR-002] refuses a relative import that climbs out of src/', () => {
    expect(() =>
      resolveRequest(fromShared, '../../../mobile/lib/api', 'android')
    ).toThrow(/outside src\//);
    expect(() =>
      resolveRequest(fromMobile, '@shared/../mobile/lib/api', 'android')
    ).toThrow(/points outside src\//);
  });

  it('[SHR-002] makes every crossing into src/ go through @shared/', () => {
    expect(() =>
      resolveRequest(fromMobile, '@/lib/supabase/server', 'android')
    ).toThrow(/Import it as "@shared\/lib\/supabase\/server"/);
    expect(() =>
      resolveRequest(
        fromMobile,
        '../../src/lib/calendar/archive-sort',
        'android'
      )
    ).toThrow(/in the web tree/);
  });

  it('[SHR-002] resolves the Babel runtime a transform injects from the app', () => {
    expect(
      resolveRequest(
        fromShared,
        '@babel/runtime/helpers/interopRequireDefault',
        'android'
      )
    ).toEqual({
      type: 'sourceFile',
      filePath: `${projectRoot}/node_modules/@babel/runtime/helpers/interopRequireDefault/index.js`,
    });
  });

  it('[SHR-001] leaves ordinary mobile imports to the default resolver', () => {
    expect(resolveRequest(fromMobile, 'react-native', 'android')).toEqual({
      type: 'sourceFile',
      filePath: `${projectRoot}/lib/node_modules/react-native/index.js`,
    });
  });
});
