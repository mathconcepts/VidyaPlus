/**
 * Step 2 (run with vite-node). Usage:
 *   gen_data.ts train <strokes-dir> <out-dir>     -> train-x.bin, train-y.bin (uint8)
 *   gen_data.ts eval  <strokes-dir> <out-file> [seed] [count] -> held-out multi-character evaluation set (JSON)
 * The default seed (2026, 240 strings, starting with 20 canonical ones) is the dev set used while tuning; the
 * final set (seed 7777, 300 strings) was generated afterwards and read once.
 * Training glyphs come from the MNIST training split, evaluation glyphs from the
 * MNIST test split (different writers), so the evaluation is held out.
 */
import fs from 'node:fs';
import path from 'node:path';
import { rasterizeChar } from '../../src/handwriting/rasterize';
import { mulberry32, uni, gauss, pick, digitStrokes, dotStrokes, minusStrokes, writeString, type Sample } from './synth';
import type { Stroke } from '../../src/handwriting/types';

const [mode, strokesDir, out, seedArg, countArg] = process.argv.slice(2);
const load = (split: string): Sample[][] => {
  const all: Sample[] = JSON.parse(fs.readFileSync(path.join(strokesDir, `strokes-${split}.json`), 'utf8'));
  const by: Sample[][] = Array.from({ length: 10 }, () => []);
  for (const s of all) by[s.d].push(s);
  return by;
};

const SCALE = (h: number) => h / 20;
const scaled = (ss: Stroke[], k: number): Stroke[] => ss.map(s => s.map(p => ({ x: p.x * k, y: p.y * k })));

if (mode === 'train') {
  const by = load('train');
  const r = mulberry32(1);
  const xs: Uint8Array[] = [], ys: number[] = [];
  const push = (strokes: Stroke[], pen: number, y: number) => {
    xs.push(Uint8Array.from(rasterizeChar(strokes, pen), v => Math.round(v * 255)));
    ys.push(y);
  };
  for (let d = 0; d < 10; d++) for (const s of by[d]) for (let k = 0; k < 3; k++) {
    const h = uni(r, 55, 130);
    push(scaled(digitStrokes(s, r, true), SCALE(h)), uni(r, 4, 8), d);
  }
  for (let i = 0; i < 24000; i++) { const h = uni(r, 55, 130); push(dotStrokes(r, h), uni(r, 4, 8), 10); }
  for (let i = 0; i < 24000; i++) { const h = uni(r, 55, 130); push(minusStrokes(r, h), uni(r, 4, 8), 11); }
  const n = xs.length;
  const X = new Uint8Array(n * 784), Y = new Uint8Array(n);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  order.forEach((src, i) => { X.set(xs[src], i * 784); Y[i] = ys[src]; });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'train-x.bin'), X);
  fs.writeFileSync(path.join(out, 'train-y.bin'), Y);
  console.log(`wrote ${n} training glyphs`);
} else if (mode === 'eval') {
  const by = load('test');
  const r = mulberry32(Number(seedArg ?? 2026));
  const canonical = seedArg && seedArg !== '2026' ? [] : ['-3.75', '0.5', '12', '2.45', '-0.5', '100', '0.125', '7.5', '-12.5', '3.14', '0', '-1', '9.81', '0.25', '45', '-0.75', '1.5', '60', '0.707', '-2'];
  const strings = [...canonical];
  const digit = () => String(Math.floor(r() * 10));
  const nz = () => String(1 + Math.floor(r() * 9));
  const run = (n: number) => Array.from({ length: n }, digit).join('');
  while (strings.length < Number(countArg ?? 240)) {
    const t = r();
    let s: string;
    if (t < 0.2) s = nz() + run(Math.floor(r() * 3));
    else if (t < 0.3) s = '-' + nz() + run(Math.floor(r() * 2));
    else if (t < 0.55) s = nz() + '.' + run(1 + Math.floor(r() * 2));
    else if (t < 0.7) s = '0.' + run(1 + Math.floor(r() * 3));
    else if (t < 0.85) s = '-' + nz() + '.' + run(1 + Math.floor(r() * 2));
    else s = '-0.' + run(1 + Math.floor(r() * 2));
    if (!strings.includes(s)) strings.push(s);
  }
  const rnd1 = (v: number) => Math.round(v * 10) / 10;
  const items = strings.map(text => {
    const { strokes, pen } = writeString(text, by, r);
    return { text, pen: Math.round(pen * 10) / 10, strokes: strokes.map(s => s.map(p => [rnd1(p.x), rnd1(p.y)])) };
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ note: 'Synthetic held-out set: MNIST-test digit shapes traced to strokes, composed into NAT strings. Not real device samples.', items }));
  console.log(`wrote ${items.length} evaluation strings`);
} else throw new Error('mode must be train or eval');
void gauss; void pick;
