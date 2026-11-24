#!/usr/bin/env node
/**
 * First-load budget (plan section 22, E11): builds /exam and fails when the
 * gzipped JS + CSS + fonts a student downloads for the first screen exceed
 * 250 KB. "First load" = every asset index.html references (script, stylesheet,
 * modulepreload, preload) plus any font file those assets reference. The
 * handwriting model (T31) loads on tap and is outside the budget.
 *
 *   node scripts/check-budget.mjs            build, then check
 *   node scripts/check-budget.mjs --no-build check the existing dist/
 *   BUDGET_KB=10 node scripts/check-budget.mjs   try a tighter limit
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const BASE = '/exam/';
const budgetKb = Number(process.env.BUDGET_KB ?? 250);

if (!process.argv.includes('--no-build')) {
  fs.rmSync(dist, { recursive: true, force: true });
  execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit' });
}

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const refs = new Set();
for (const m of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"[^>]*>/g)) {
  const tag = m[0];
  const url = m[1];
  const rel = /\brel="([^"]+)"/.exec(tag)?.[1] ?? '';
  if (/<script/.test(tag) || /stylesheet|modulepreload|preload/.test(rel)) refs.add(url);
}

const files = new Map();
const add = (urlPath, from) => {
  if (/^https?:/.test(urlPath)) throw new Error(`external asset in first load (${from}): ${urlPath}`);
  const clean = urlPath.split(/[?#]/)[0];
  const rel = clean.startsWith(BASE) ? clean.slice(BASE.length) : clean.replace(/^\.?\//, '');
  const abs = path.join(dist, rel);
  if (files.has(abs)) return;
  if (!fs.existsSync(abs)) throw new Error(`${from} references a missing file: ${urlPath}`);
  files.set(abs, from);
  if (/\.css$/.test(abs)) {
    const css = fs.readFileSync(abs, 'utf8');
    for (const f of css.matchAll(/url\(\s*["']?([^"')]+\.(?:woff2?|ttf|otf))(?:[?#][^"')]*)?["']?\s*\)/g)) {
      add(path.posix.join(path.posix.dirname(`/${path.relative(dist, abs)}`), f[1]).replace(/^\//, BASE), path.basename(abs));
    }
  }
};
for (const r of refs) add(r, 'index.html');

let total = 0;
const rows = [];
for (const abs of files.keys()) {
  const gz = zlib.gzipSync(fs.readFileSync(abs), { level: 9 }).length;
  total += gz;
  rows.push([path.relative(dist, abs), gz]);
}
const kind = f => (/\.js$/.test(f) ? 'js' : /\.css$/.test(f) ? 'css' : /\.(woff2?|ttf|otf)$/.test(f) ? 'font' : 'other');
for (const [f, gz] of rows) console.log(`  ${kind(f).padEnd(5)} ${(gz / 1024).toFixed(1).padStart(7)} KB gz  ${f}`);
const kb = total / 1024;
console.log(`first load: ${kb.toFixed(1)} KB gzipped (budget ${budgetKb} KB) across ${rows.length} files`);
if (kb > budgetKb) {
  console.error(`FAIL: first-load JS+CSS+fonts is ${kb.toFixed(1)} KB, over the ${budgetKb} KB budget.`);
  process.exit(1);
}
console.log('OK: within budget.');
