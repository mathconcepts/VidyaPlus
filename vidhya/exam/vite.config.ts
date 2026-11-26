import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

// E10: the build id the app was built with. The brain image is built from the same commit and reports
// the same id (BUILD_ID) in X-Vidhya-Build; a mismatch shows the refresh banner.
function buildId(): string {
  if (process.env.BUILD_ID) return process.env.BUILD_ID;
  try { return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'dev'; }
}

// KaTeX CSS and its woff2 fonts, emitted under /exam/katex/ and loaded lazily by the app (lib/katex-css.ts).
// Only woff2 is shipped: every browser that can run this app reads it. The woff and ttf fallbacks in the
// upstream stylesheet are dropped so a font download is never wasted on a format the browser will not use.
function katexAssets(): Plugin {
  const dist = path.resolve(__dirname, 'node_modules/katex/dist');
  const dist2 = path.resolve(__dirname, '../node_modules/katex/dist');
  const root = fs.existsSync(dist) ? dist : dist2;
  const css = (): string =>
    fs.readFileSync(path.join(root, 'katex.min.css'), 'utf8')
      .replace(/,url\([^)]*\.woff\)\s*format\("woff"\)/g, '')
      .replace(/,url\([^)]*\.ttf\)\s*format\("truetype"\)/g, '');
  return {
    name: 'vidhya-katex-assets',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'katex/katex.min.css', source: css() });
      for (const f of fs.readdirSync(path.join(root, 'fonts'))) {
        if (f.endsWith('.woff2')) this.emitFile({ type: 'asset', fileName: `katex/fonts/${f}`, source: fs.readFileSync(path.join(root, 'fonts', f)) });
      }
    },
    configureServer(server) {
      server.middlewares.use('/exam/katex/', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]!);
        if (rel === '/katex.min.css') { res.setHeader('content-type', 'text/css'); res.end(css()); return; }
        const m = /^\/fonts\/([A-Za-z0-9_-]+\.woff2)$/.exec(rel);
        if (m && fs.existsSync(path.join(root, 'fonts', m[1]!))) { res.setHeader('content-type', 'font/woff2'); res.end(fs.readFileSync(path.join(root, 'fonts', m[1]!))); return; }
        next();
      });
    },
  };
}

// /exam is served by the Exam Brain at /exam/ (plan section 22, amendment of 24 Nov).
// `--mode demo` (npm run build:demo) is the static look-and-feel build: relative asset paths so it runs under any
// sub-path of any static host. It turns handwriting on (VITE_EXAM_HANDWRITING=1) and swaps in synthetic data (src/demo/).
export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? './' : '/exam/',
  plugins: [
    react(),
    katexAssets(),
    // Demo only: an inline icon, so a host that has no /favicon.ico at its root does not log a 404.
    ...(mode === 'demo' ? [{ name: 'vidhya-demo-favicon', transformIndexHtml: () => [{ tag: 'link', attrs: { rel: 'icon', href: 'data:,' }, injectTo: 'head' as const }] }] : []),
  ],
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
    ...(mode === 'demo' ? { 'import.meta.env.VITE_EXAM_HANDWRITING': JSON.stringify('1') } : {}),
  },
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
}));
