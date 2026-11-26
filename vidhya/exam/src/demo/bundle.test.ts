/**
 * The production bundle is unchanged by the demo build: no demo code, no fake data, base /exam/.
 * The demo bundle has them, with relative paths. Both are built for real, into a temp folder.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const MARKERS = ['Synthetic demo record', 'demo-attempt', 'Demo controls', 'Demo · sample data'];

function allText(dir: string): string {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? [allText(p)] : /\.(js|css|html)$/.test(e.name) ? [fs.readFileSync(p, 'utf8')] : [];
  }).join('\n');
}

/** The test runner's own variables (NODE_ENV=test, VITEST*) would change what the child build does. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' };
  for (const k of Object.keys(env)) if (/^VITEST|^VITE_/.test(k)) delete env[k];
  return env;
}

async function buildTo(mode: string): Promise<string> {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), `exam-${mode}-`));
  // A child process: esbuild cannot run inside the jsdom test environment.
  execFileSync(path.resolve(root, '../node_modules/.bin/vite'), ['build', '--mode', mode, '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { cwd: root, stdio: 'pipe', env: cleanEnv() });
  return out;
}

describe('bundles', () => {
  let prod = '';
  let demo = '';
  beforeAll(async () => { prod = await buildTo('production'); demo = await buildTo('demo'); }, 180_000);

  it('production: base /exam/, no demo code, no fake data, handwriting flag off', () => {
    const html = fs.readFileSync(path.join(prod, 'index.html'), 'utf8');
    expect(html).toContain('src="/exam/assets/');
    const text = allText(prod);
    for (const m of MARKERS) expect(text, m).not.toContain(m);
    expect(text).not.toMatch(/x\^2e\^\{?x/); // a demo item source never ships
    expect(fs.readdirSync(path.join(prod, 'assets')).some(f => /^mount-/.test(f))).toBe(false);
  });

  it('demo: relative base, demo shell and notice present, KaTeX css relative', () => {
    const html = fs.readFileSync(path.join(demo, 'index.html'), 'utf8');
    expect(html).toContain('src="./assets/');
    expect(html).not.toContain('"/exam/');
    const text = allText(demo);
    expect(text).toContain('Demo · sample data, nothing is saved');
    expect(text).toContain('Synthetic demo record');
    expect(text).not.toContain('/exam/');
    expect(fs.existsSync(path.join(demo, 'katex/katex.min.css'))).toBe(true);
    expect(fs.existsSync(path.join(demo, 'handwriting/weights.bin'))).toBe(true);
  });
});
