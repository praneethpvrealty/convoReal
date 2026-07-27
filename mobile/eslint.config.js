// https://docs.expo.dev/guides/using-eslint/
//
// This file has to exist even though the repo root has its own config:
// ESLint resolves flat config by walking UP from the working directory,
// so without it `expo lint` here found the root Next.js config — which
// globally ignores `mobile/**` — and reported every file as ignored.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'web-build/*', 'expo-env.d.ts'],
  },
  {
    // Baseline for the React Compiler rules eslint-config-expo 57 turns
    // on. The app predates them and trips 19 across 13 files, so they
    // are warnings for now — errors would mean landing a lint script
    // that fails on first run, which is how the last setup got ignored.
    // Warnings still print, so the debt stays visible. Burn it down and
    // promote these back to "error".
    //
    // Not all of it is real. `refs` and `immutability` fire on the
    // standard Animated (`useRef(new Animated.Value()).current` then
    // `.interpolate()` during render) and Reanimated (`shared.value =`
    // inside a handler) APIs, which are correct as written. The
    // `set-state-in-effect` hits are the genuine ones: sheets syncing
    // props into state on open, which does cost an extra render pass.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
]);
