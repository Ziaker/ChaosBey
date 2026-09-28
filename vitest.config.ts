import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Build metadata Vite injects in the app (vite.config.ts); fixed values
  // here so modules that report it (telemetry, debug reports) run in tests.
  define: {
    __APP_BUILD_VERSION__: JSON.stringify('test'),
    __APP_COMMIT_HASH__: 'null',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
