import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@vidhya/ui': path.resolve(__dirname, '../vidhya/ui'),
    },
    // vidhya/ui declares React as a peer dependency; resolve it from here so
    // the legacy app and the shared package load a single copy.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 3000,
    fs: { allow: ['..'] },
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/solutions': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/telegram': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/demo-login': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // Animation
          'motion': ['framer-motion'],
          // Heavy client-side ML / parsing — lazy-loaded on demand
          'transformers': ['@xenova/transformers'],
          'pdf': ['pdfjs-dist', 'mammoth'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
