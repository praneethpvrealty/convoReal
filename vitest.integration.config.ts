import { defineConfig } from "vitest/config";

// Separate config for *.integration.test.ts files — these call the
// real service_role Supabase client against the live database (no
// mocking). Kept out of vitest.config.ts's default include/exclude so
// `npm test` never touches the network or requires secrets; run these
// explicitly with `npm run test:integration`.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    // No dummy secrets here — these tests load real credentials from
    // .env.local themselves (see credit-engine.integration.test.ts)
    // and skip entirely (describe.skipIf) if they're absent, so a
    // contributor without .env.local gets a clean skip, not a crash.
    testTimeout: 20_000,
    clearMocks: true,
  },
});
