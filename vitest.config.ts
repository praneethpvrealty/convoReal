import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    // Component tests opt into jsdom per file with
    // `// @vitest-environment jsdom`; this setup stubs the layout-backed
    // browser APIs jsdom lacks and is a no-op under node.
    setupFiles: ["./src/test/setup-dom.ts"],
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
      // Overrides a real key in the developer's shell, which is the
      // point. A unit test that reaches unmocked provider code should
      // fail loudly on a bogus credential, not quietly bill the account
      // and pass — and a test whose result depends on whether the person
      // running it has an API key is not a test. Keys are listed here
      // rather than left unset because "unset" is itself a behaviour
      // (features degrade to disabled), and one that hides the calls.
      GEMINI_API_KEY: "test-gemini-api-key",
      STABILITY_API_KEY: "test-stability-api-key",
      HF_ACCESS_TOKEN: "test-hf-access-token",
      SARVAM_API_KEY: "test-sarvam-api-key",
      RESEND_API_KEY: "test-resend-api-key",
      GOOGLE_MAPS_API_KEY: "test-google-maps-api-key",
    },
    clearMocks: true,
  },
});
