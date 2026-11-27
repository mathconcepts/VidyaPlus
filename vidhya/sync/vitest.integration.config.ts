import { defineConfig } from 'vitest/config';

// Needs a running DeepTutor (integration/up.sh). Run: npm run test:integration
// The tests sit at the top of integration/, so the glob never descends into a directory: container-written
// runtime state (owned by DeepTutor's user, private modes) must never be scanned, wherever it ends up.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['integration/*.itest.ts'],
    exclude: ['**/node_modules/**', 'integration/.run/**', 'integration/fixtures/**'],
    testTimeout: 30_000,
  },
});
