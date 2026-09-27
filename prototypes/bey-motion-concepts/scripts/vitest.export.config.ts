import { defineConfig } from 'vitest/config';

// Runs the replay exporter only (not part of `npm test`):
//   npx vitest run --config prototypes/bey-motion-concepts/scripts/vitest.export.config.ts
export default defineConfig({
  test: {
    environment: 'node',
    include: ['prototypes/bey-motion-concepts/scripts/*.export.ts'],
  },
});
