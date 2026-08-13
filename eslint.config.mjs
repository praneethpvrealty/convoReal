import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import supabaseWriteGuard from "./eslint-rules/supabase-write-guard.cjs";
import noEnvLocalInUnitTests from "./eslint-rules/no-env-local-in-unit-tests.cjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: {
      convoreal: {
        rules: {
          "supabase-write-guard": supabaseWriteGuard,
          "no-env-local-in-unit-tests": noEnvLocalInUnitTests,
        },
      },
    },
    // 'error' now that the backlog is clear: every RLS-scoped write
    // either reads back what it changed or carries a written reason why
    // zero rows is its normal path. Keep it that way — a new write that
    // cannot tell a refusal from a success should not reach main.
    rules: { "convoreal/supabase-write-guard": "error" },
  },
  {
    // Test teardown deletes whatever the run happened to create, so
    // zero rows is the normal case rather than a refusal to report.
    files: ["**/*.test.ts", "**/*.test.tsx", "e2e/**"],
    rules: { "convoreal/supabase-write-guard": "off" },
  },
  {
    // A unit test that reads .env.local pulls the developer's real
    // secrets into the test process and makes the suite's result depend
    // on who ran it. Secrets belong in `test.env` in vitest.config.ts.
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: { "convoreal/no-env-local-in-unit-tests": "error" },
  },
  {
    // Integration tests hit the real Supabase project with real
    // credentials on purpose, and `npm test` never runs them.
    files: ["**/*.integration.test.ts"],
    rules: { "convoreal/no-env-local-in-unit-tests": "off" },
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
    // The MCP server is a standalone package with its own tsconfig and
    // deps (`cd mcp && npm run typecheck && npm test`).
    "mcp/**",
    // Standalone Remotion project for the marketing net video.
    "docs/marketing/net-video/**",
  ]),
]);

export default eslintConfig;
