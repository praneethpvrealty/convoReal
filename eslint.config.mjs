import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import supabaseWriteGuard from "./eslint-rules/supabase-write-guard.cjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: { convoreal: { rules: { "supabase-write-guard": supabaseWriteGuard } } },
    // Every .delete() is clean. The 122 that remain are all .update(),
    // kept at 'warn' because rewriting them blind would be a worse change
    // than the bug — the same bargain the mobile config strikes with the
    // React Compiler rules: visible in the log and blocking for nothing,
    // rather than silently off. Clear them file by file, do not add new
    // ones, and flip this to 'error' once it is quiet.
    rules: { "convoreal/supabase-write-guard": "warn" },
  },
  {
    // Test teardown deletes whatever the run happened to create, so
    // zero rows is the normal case rather than a refusal to report.
    files: ["**/*.test.ts", "**/*.test.tsx", "e2e/**"],
    rules: { "convoreal/supabase-write-guard": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "scratch/**",
    // The Expo app has its own lint setup (`cd mobile && npm run lint`).
    "mobile/**",
    // Standalone Remotion project for the marketing net video.
    "docs/marketing/net-video/**",
  ]),
]);

export default eslintConfig;
