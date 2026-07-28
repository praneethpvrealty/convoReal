import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': root.replace(/\/$/, '') },
  },
  test: {
    environment: 'node',
    // Pure logic only. Screens and the lib modules that reach for
    // Supabase, Expo or React Native need a native runtime this plain
    // Node runner does not provide — those are covered by `typecheck`
    // and by running the app.
    include: ['lib/**/*.test.ts'],
  },
});
