import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // *.integration.test.ts files hit the real, shared Supabase project
    // over the network (service_role client, no mocking) — they must
    // never run as part of the fast default suite (`npm test`), which
    // has to pass with zero network access and no secrets configured
    // (e.g. CI without SUPABASE_SERVICE_ROLE_KEY). Run them explicitly
    // via `npm run test:integration` (vitest.integration.config.ts).
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
    // Dummy secrets — encryption.ts / webhook-signature.ts read these
    // at module load. Tests never hit a real Meta/Supabase service, so
    // any 32-byte hex / non-empty string will do; keep them lexically
    // identical to the CI build env so behaviour matches.
    env: {
      ENCRYPTION_KEY:
        "0000000000000000000000000000000000000000000000000000000000000000",
      META_APP_SECRET: "test-meta-app-secret",
    },
    clearMocks: true,
    coverage: {
      provider: "v8",
      // Instrument the whole app (all: true is implied by an include
      // glob) so untested routes count against the denominator — the
      // point is to discourage new code landing with no test.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
        "src/types/**",
        "src/scripts/**",
      ],
      reporter: ["text-summary", "json-summary"],
      // Ratchet floor: set just under the current numbers with a little
      // headroom. `npm run test:coverage` fails if coverage drops below
      // these — raise them as coverage climbs; never lower them.
      thresholds: {
        lines: 10,
        statements: 10,
        branches: 10,
        functions: 8,
      },
    },
  },
});
