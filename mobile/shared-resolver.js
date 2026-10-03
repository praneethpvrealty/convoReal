const path = require('path');

/**
 * Lets the app bundle pure web modules from ../src through `@shared/*`
 * and nothing else from that tree.
 *
 * - A mobile file reaches ../src only through `@shared/`. A relative
 *   path into ../src, or tsconfig's `@/*` falling back to ../src, is
 *   refused so every crossing is visible at the import site.
 * - A module under ../src may only import other modules under ../src
 *   by relative path. No packages, no `@/` alias, no Node built-ins —
 *   so a Supabase server client, `next/*` or anything else that only
 *   runs on the web server cannot be pulled into the bundle by a shared
 *   module, directly or transitively. `import type` is erased by Babel
 *   before Metro sees it, so type-only imports stay allowed.
 * - The one exception is `@babel/runtime`, which Babel itself injects
 *   into transformed files; it resolves from this app's node_modules.
 */

const SHARED_PREFIX = '@shared/';
const RELATIVE = /^\.\.?(?:\/|$)/;
const BABEL_RUNTIME = /^@babel\/runtime\//;

function isInside(root, file) {
  const rel = path.relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function resolvedFiles(resolution) {
  if (resolution.type === 'sourceFile') return [resolution.filePath];
  if (resolution.type === 'assetFiles') return resolution.filePaths;
  return [];
}

function createSharedResolver({ projectRoot, sharedRoot, upstream = null }) {
  const projectOrigin = path.join(projectRoot, 'package.json');
  const display = (file) => path.relative(projectRoot, file);

  return function resolveRequest(context, moduleName, platform) {
    const resolve = (ctx, name) =>
      upstream
        ? upstream(ctx, name, platform)
        : ctx.resolveRequest(ctx, name, platform);
    const origin = context.originModulePath;

    if (isInside(sharedRoot, origin)) {
      if (BABEL_RUNTIME.test(moduleName)) {
        return resolve(
          { ...context, originModulePath: projectOrigin },
          moduleName
        );
      }
      if (!RELATIVE.test(moduleName)) {
        throw new Error(
          `${display(origin)} imports "${moduleName}", but it is bundled into ` +
            'the mobile app through @shared/, so it may only import other ' +
            'files under src/ by relative path. Keep the shared rule ' +
            'dependency-free, or leave this module web-only.'
        );
      }
      const resolution = resolve(context, moduleName);
      for (const file of resolvedFiles(resolution)) {
        if (!isInside(sharedRoot, file)) {
          throw new Error(
            `${display(origin)} imports "${moduleName}", which resolves to ` +
              `${display(file)} outside src/. A module shared with the ` +
              'mobile app may only import other files under src/.'
          );
        }
      }
      return resolution;
    }

    if (moduleName.startsWith(SHARED_PREFIX)) {
      const target = path.resolve(
        sharedRoot,
        moduleName.slice(SHARED_PREFIX.length)
      );
      if (!isInside(sharedRoot, target)) {
        throw new Error(`"${moduleName}" points outside src/.`);
      }
      return resolve(context, target);
    }

    const resolution = resolve(context, moduleName);
    for (const file of resolvedFiles(resolution)) {
      if (isInside(sharedRoot, file)) {
        throw new Error(
          `${display(origin)} imports "${moduleName}", which resolves to ` +
            `${display(file)} in the web tree. Import it as ` +
            `"${SHARED_PREFIX}${path
              .relative(sharedRoot, file)
              .replace(/\\/g, '/')
              .replace(/\.[jt]sx?$/, '')}" so the dependency-free rule ` +
            'applies to it.'
        );
      }
    }
    return resolution;
  };
}

module.exports = { createSharedResolver };
