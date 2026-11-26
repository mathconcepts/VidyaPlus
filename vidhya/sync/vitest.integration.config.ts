import { defineConfig } from 'vitest/config';

// Needs a running DeepTutor (integration/up.sh). Run: npm run test:integration
export default defineConfig({
  test: { environment: 'node', include: ['integration/**/*.itest.ts'], testTimeout: 30_000 },
});
