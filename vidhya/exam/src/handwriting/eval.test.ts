/**
 * Accuracy gate for the handwriting recogniser (T31, DR15b).
 * Runs the real pipeline (segment -> glyph image -> shipped weights on the TF.js
 * CPU backend -> decode) over tools/handwriting/eval/eval-set.json: held-out
 * multi-character NAT strings built from MNIST-test digit shapes traced to
 * strokes (different writers from training) plus procedural "." and "-".
 * It is a synthetic stand-in: the plan's gate on 50 real device samples (DR15b)
 * is still a human check before release.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import { buildClassifier, makeRecognizer, type WeightsManifest } from './model';
import { tryParseNat } from '@vidhya/shared/nat-input';
import { handwritingEnabled } from '../features';

const ROOT = path.resolve(__dirname, '../..');
type EvalSet = { items: { text: string; pen: number; strokes: number[][][] }[] };
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/handwriting/eval', f), 'utf8')) as EvalSet;
/** dev: used while tuning. final: generated afterwards with another seed and read once, the headline number. */
const sets = { dev: read('eval-set.json'), final: read('eval-final.json') };
const set = sets.final;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/handwriting/weights.json'), 'utf8')) as WeightsManifest;
const bin = fs.readFileSync(path.join(ROOT, 'public/handwriting/weights.bin'));
const bytes = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;

/** The accuracy that justifies switching the Write button on. */
const GATE = 0.95;

describe('handwriting evaluation set', () => {
  it('has at least 50 held-out multi-character strings', () => {
    expect(set.items.length).toBeGreaterThanOrEqual(50);
    expect(set.items.filter(i => i.text.length > 1).length).toBeGreaterThanOrEqual(50);
    for (const i of set.items) expect(tryParseNat(i.text).ok).toBe(true);
  });

  it('weights stay under the 200 KB target', () => {
    expect(bin.length).toBeLessThan(200 * 1024);
  });

  // The dev set (used while tuning) is slow on the CPU backend: HW_EVAL_DEV=1 includes it.
  const run = Object.entries(sets).filter(([n]) => n === 'final' || process.env.HW_EVAL_DEV === '1');
  for (const [name, ev] of run) {
    it(`${name} set: exact-string accuracy is measured, stays above a regression floor, and agrees with the flag`, async () => {
      await tf.setBackend('cpu');
      await tf.ready();
      const recognize = makeRecognizer(buildClassifier(tf, manifest, bytes));
      let ok = 0, chars = 0, charOk = 0;
      const misses: string[] = [];
      for (const it of ev.items) {
        const got = await recognize(it.strokes.map(s => s.map(([x, y]) => ({ x, y }))), it.pen);
        if (got.text === it.text) ok++; else misses.push(`${it.text} -> ${got.text}`);
        chars += it.text.length;
        for (let i = 0; i < it.text.length; i++) if (got.text.length === it.text.length && got.text[i] === it.text[i]) charOk++;
      }
      const acc = ok / ev.items.length;
      console.log(`handwriting eval ${name}: ${ok}/${ev.items.length} exact = ${(acc * 100).toFixed(1)}% (per-character ${(100 * charOk / chars).toFixed(1)}%); misses: ${misses.join(', ')}`);
      expect(acc).toBeGreaterThanOrEqual(0.9); // regression floor
      if (name === 'final') {
        // The flag may default to on only when the gate is met (DR15b: ">=95% before release").
        const defaultOn = import.meta.env.VITE_EXAM_HANDWRITING === '1';
        expect(defaultOn && acc < GATE).toBe(false);
        expect(handwritingEnabled()).toBe(defaultOn);
      }
    }, 300_000);
  }
});
