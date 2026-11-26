/**
 * B5 marks range: an 80% bootstrap interval for the student's marks in the EM
 * section. Deterministic (seeded PRNG, fixed resample count), so the same
 * attempts always give the same range and a refresh never moves the number.
 *
 * Estimate = (sum awarded / sum max) x section marks, per resample of attempts
 * with replacement. Gate (O5-5): shown only once the scored mock is completed
 * OR the student has at least MIN_ATTEMPTS_FOR_RANGE attempts.
 */
import { BrainError } from '../errors.js';

export const MIN_ATTEMPTS_FOR_RANGE = 30;
export const RESAMPLES = 2000;
export const INTERVAL_LEVEL = 0.8;
/** Below this many samples the interval is real but wide; the UI should say so. */
export const LOW_N = 10;
export const NEEDS_MORE_MESSAGE = 'Take the mock to see your marks range.';

export interface RangeSample {
  awarded: number;
  max: number;
}

export interface MarksRange {
  status: 'ok';
  low: number;
  estimate: number;
  high: number;
  level: number;
  n: number;
  section_marks: number;
  label: string;
  low_n: boolean;
}

export interface RangeNeedsMore {
  status: 'needs_more';
  attempts: number;
  message: string;
}

/** mulberry32: small, fast, well distributed, and identical on every platform. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, to turn a student hash into a stable seed. */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function ratio(samples: readonly RangeSample[]): number {
  let a = 0;
  let m = 0;
  for (const s of samples) {
    a += s.awarded;
    m += s.max;
  }
  return m > 0 ? a / m : 0;
}

/** The interval alone, no gating. Throws InvalidMarksQuery on empty input or a bad section size. */
export function bootstrapRange(
  samples: readonly RangeSample[],
  sectionMarks: number,
  opts: { seed: string | number; resamples?: number } ,
): MarksRange {
  if (!(sectionMarks > 0) || !Number.isFinite(sectionMarks)) throw new BrainError('InvalidMarksQuery', 'section marks must be a positive number');
  if (samples.length === 0) throw new BrainError('InvalidMarksQuery', 'no attempts to resample');
  const B = opts.resamples ?? RESAMPLES;
  const rand = mulberry32(typeof opts.seed === 'number' ? opts.seed : seedFrom(`${opts.seed}:${samples.length}`));
  const n = samples.length;
  const draws = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let a = 0;
    let m = 0;
    for (let i = 0; i < n; i++) {
      const s = samples[Math.floor(rand() * n)]!;
      a += s.awarded;
      m += s.max;
    }
    draws[b] = m > 0 ? a / m : 0;
  }
  draws.sort();
  const tail = (1 - INTERVAL_LEVEL) / 2;
  const lo = draws[Math.floor(tail * B)]!;
  const hi = draws[Math.min(B - 1, Math.ceil((1 - tail) * B) - 1)]!;
  const toMarks = (r: number) => round2(clamp(r, 0, 1) * sectionMarks);
  return {
    status: 'ok',
    low: toMarks(lo),
    estimate: toMarks(ratio(samples)),
    high: toMarks(hi),
    level: INTERVAL_LEVEL,
    n,
    section_marks: sectionMarks,
    label: `estimate from ${n} attempts`,
    low_n: n < LOW_N,
  };
}

/** The gated range. `attempts` is the student's attempt count (what the 30 is counted on). */
export function gatedRange(input: {
  samples: readonly RangeSample[];
  attempts: number;
  mock_completed: boolean;
  section_marks: number;
  seed: string | number;
  resamples?: number;
}): MarksRange | RangeNeedsMore {
  const open = input.mock_completed || input.attempts >= MIN_ATTEMPTS_FOR_RANGE;
  if (!open || input.samples.length === 0) return { status: 'needs_more', attempts: input.attempts, message: NEEDS_MORE_MESSAGE };
  return bootstrapRange(input.samples, input.section_marks, { seed: input.seed, resamples: input.resamples });
}
