/**
 * Keep non-native release tooling out of the runtime fingerprint.
 *
 * Fingerprint hashes eas.json whole, under a single "easBuild" reason,
 * without regard for which profile is being built. So adding an unrelated
 * build profile shifts the runtime version for every platform, and every
 * installed build silently stops matching published updates — it reports
 * "up to date" while sitting on an old bundle.
 *
 * package.json scripts are commands for developers and CI. Adding or
 * renaming one does not change the native binary, so hashing the live scripts
 * section would also strand otherwise-compatible OTA updates. The anchored
 * source below preserves the fingerprint used by installed builds while
 * future script-only edits stay stable. Package dependencies remain
 * fingerprinted and still trigger a new native runtime.
 *
 * The profiles do carry native-affecting settings (android.buildType,
 * ios.simulator, the environment a build resolves). Those still need a
 * rebuild; nothing here will prompt for one.
 *
 * experiments.onDemandFilesystem (set in app.config.js) only changes how
 * Metro reads files while bundling. The hook drops it from the hashed
 * Expo config, and an empty experiments object with it, so turning it
 * off did not move the runtime version off the installed builds.
 *
 * @type {import('@expo/fingerprint').Config}
 */
function withoutBundlerOnlyExperiments(contents) {
  const config = JSON.parse(contents);
  if (!config.experiments || !('onDemandFilesystem' in config.experiments)) {
    return contents;
  }
  delete config.experiments.onDemandFilesystem;
  if (Object.keys(config.experiments).length === 0) delete config.experiments;
  return JSON.stringify(config);
}

module.exports = {
  ignorePaths: ['eas.json'],
  fileHookTransform: (source, chunk) =>
    source.type === 'contents' && source.id === 'expoConfig' && chunk != null
      ? withoutBundlerOnlyExperiments(chunk.toString())
      : chunk,
  sourceSkips: ['PackageJsonScriptsAll'],
  extraSources: [
    {
      type: 'contents',
      id: 'packageJson:scripts',
      contents:
        '{"start":"expo start","lint":"expo lint","test":"vitest run","typecheck":"tsc --noEmit","test:e2e:contact-notes":"maestro test e2e/maestro/contact-notes-keyboard.yaml"}',
    },
  ],
};
