import { defineConfig } from 'vitest/config';

// The MCP server has its own dependency tree and no Next.js, JSX or
// path aliases, so it does not inherit the root config — without this
// file vitest walks up and loads the app's, which pulls in a DOM setup
// file that does not exist here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
