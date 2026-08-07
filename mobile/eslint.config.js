const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// Shared with the web config — one implementation, both packages.
const supabaseWriteGuard = require('../eslint-rules/supabase-write-guard.cjs');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['.expo/*', 'dist/*', 'node_modules/*', 'scripts/*'],
  },
  {
    plugins: { convoreal: { rules: { 'supabase-write-guard': supabaseWriteGuard } } },
    // 'warn' for the same reason as the rules below: it lands on 11
    // existing writes here, so it is visible rather than blocking. Clear
    // them file by file, do not add new ones.
    rules: { 'convoreal/supabase-write-guard': 'warn' },
  },
  {
    rules: {
      // A web rule that does not apply here: React Native's <Text> renders
      // HTML entities literally, so "&apos;" would ship as those six
      // characters. The rule's own suggested fix breaks the UI.
      'react/no-unescaped-entities': 'off',

      // The React Compiler rule set arrived with eslint-config-expo 57,
      // years of code after these patterns were written, and it fires on
      // idioms this app is built on — `useRef(new Animated.Value()).current`,
      // Reanimated's `shared.value = withSpring(...)`, and effects that sync
      // state from props. Left at 'warn': visible in the log and blocking for
      // nothing, rather than silently off. Fix them file by file; do not add
      // new ones.
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
]);
