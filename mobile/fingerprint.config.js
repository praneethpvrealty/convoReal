/**
 * Keep eas.json out of the runtime fingerprint.
 *
 * Fingerprint hashes eas.json whole, under a single "easBuild" reason,
 * without regard for which profile is being built. So adding an unrelated
 * build profile shifts the runtime version for every platform, and every
 * installed build silently stops matching published updates — it reports
 * "up to date" while sitting on an old bundle.
 *
 * The profiles do carry native-affecting settings (android.buildType,
 * ios.simulator, the environment a build resolves). Those still need a
 * rebuild; nothing here will prompt for one.
 *
 * @type {import('@expo/fingerprint').Config}
 */
module.exports = {
  ignorePaths: ['eas.json'],
};
