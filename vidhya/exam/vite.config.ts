import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// /exam is served by the Exam Brain at /exam/ (plan section 22, amendment of 24 Nov).
export default defineConfig({
  base: '/exam/',
  plugins: [react()],
  resolve: {
    alias: {
      // The one NAT parser, shared with the brain (E4). Imported by path, not copied.
      '@vidhya/shared': path.resolve(__dirname, '../shared'),
    },
    // One React for the app and @vidhya/ui (a peer dependency).
    dedupe: ['react', 'react-dom'],
  },
  server: { fs: { allow: ['..'] } },
  build: {
    target: 'es2020',
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
