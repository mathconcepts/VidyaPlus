import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // The e2e smoke test loads the /exam app's HttpExamApi by path; it imports the shared contract by this alias.
  resolve: { alias: { '@vidhya/shared': path.resolve(__dirname, '../shared') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
