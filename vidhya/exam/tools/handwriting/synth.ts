/**
 * Stroke synthesis shared by training-data and evaluation-set generation.
 * Digit shapes come from skeleton-traced MNIST strokes (see extract_strokes.py);
 * "." and "-" are drawn procedurally. Everything is seeded, so runs repeat.
 * Coordinates are canvas CSS pixels, like the pad produces.
 */
import type { Point, Stroke } from '../../src/handwriting/types';

export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const uni = (r: Rng, a: number, b: number) => a + (b - a) * r();
export const gauss = (r: Rng) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
export const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

export interface Sample { d: number; s: number[][][] }

/** A traced MNIST digit as strokes in a frame where the glyph is ~20 units tall, with handwriting-like variation. */
export function digitStrokes(sample: Sample, r: Rng, augment: boolean): Stroke[] {
  const th = augment ? gauss(r) * 0.12 : 0;
  const sh = augment ? gauss(r) * 0.15 : 0;
  const sx = augment ? uni(r, 0.85, 1.15) : 1;
  const sy = augment ? uni(r, 0.85, 1.15) : 1;
  const c = Math.cos(th), s = Math.sin(th);
  // Smooth elastic warp: neighbouring points (and strokes that meet) move together.
  const amp = augment ? uni(r, 0.3, 0.9) : 0.3;
  const w = [0, 1, 2, 3].map(() => ({ f: uni(r, 0.15, 0.4), p: uni(r, 0, 6.28), a: amp * uni(r, 0.5, 1) }));
  const warp = (x: number, y: number) => ({
    x: x + w[0].a * Math.sin(w[0].f * y + w[0].p) + w[1].a * Math.cos(w[1].f * x + w[1].p),
    y: y + w[2].a * Math.sin(w[2].f * x + w[2].p) + w[3].a * Math.cos(w[3].f * y + w[3].p),
  });
  return sample.s.map(st => st.map(([x, y]) => {
    let px = (x - 14) * sx, py = (y - 14) * sy;
    px += sh * py;
    const q = warp(px * c - py * s, px * s + py * c);
    return { x: q.x + gauss(r) * 0.06, y: q.y + gauss(r) * 0.06 };
  }));
}

const ptsOf = (ss: Stroke[]) => ss.flat();
function bbox(ss: Stroke[]) {
  const p = ptsOf(ss);
  return { minX: Math.min(...p.map(a => a.x)), maxX: Math.max(...p.map(a => a.x)), minY: Math.min(...p.map(a => a.y)), maxY: Math.max(...p.map(a => a.y)) };
}
const place = (ss: Stroke[], f: (p: Point) => Point): Stroke[] => ss.map(s => s.map(f));

/** A written dot of diameter ~d: a tap, or a tiny scribble. Centred at the origin. */
export function dotStrokes(r: Rng, h: number): Stroke[] {
  const rad = uni(r, 0, 0.05) * h;
  if (r() < 0.55) return [[{ x: gauss(r) * 0.4, y: gauss(r) * 0.4 }]];
  const n = 2 + Math.floor(r() * 3);
  return [Array.from({ length: n }, () => ({ x: gauss(r) * rad, y: gauss(r) * rad }))];
}

/** A written minus of length ~0.2-0.7 h, slightly tilted and curved. Centred at the origin. */
export function minusStrokes(r: Rng, h: number): Stroke[] {
  const L = uni(r, 0.22, 0.7) * h, tilt = gauss(r) * 0.08, bend = gauss(r) * 0.04 * L;
  const pts = [-0.5, 0, 0.5].map((t, i) => ({ x: t * L * Math.cos(tilt), y: t * L * Math.sin(tilt) + (i === 1 ? bend : 0) + gauss(r) * 0.015 * L }));
  return [r() < 0.5 ? pts : pts.reverse()];
}

/** Lay out a NAT string as strokes: ch -> glyph, left to right, jittered size, baseline and gaps. */
export function writeString(text: string, digits: Sample[][], r: Rng, opts: { minGap?: number } = {}): { strokes: Stroke[]; pen: number } {
  const H = uni(r, 55, 130);
  const pen = uni(r, 4, 8);
  const minGap = opts.minGap ?? 0.07;
  const slope = gauss(r) * 0.03;
  let cursor = 0;
  const out: Stroke[] = [];
  for (const ch of text) {
    const hh = H * uni(r, 0.9, 1.1);
    let g: Stroke[];
    let yMid = 0;
    if (ch === '.') { g = dotStrokes(r, hh); yMid = hh * 0.5 - hh * uni(r, 0.02, 0.1); }
    else if (ch === '-') { g = minusStrokes(r, hh); yMid = uni(r, -0.08, 0.08) * hh; }
    else {
      const s = pick(r, digits[Number(ch)]);
      g = place(digitStrokes(s, r, true), p => ({ x: p.x * hh / 20, y: p.y * hh / 20 }));
    }
    const b = bbox(g);
    const dx = cursor - b.minX;
    const cy = (b.minY + b.maxY) / 2;
    const placed = place(g, p => ({ x: p.x + dx, y: p.y - cy + yMid + (p.x + dx) * slope }));
    out.push(...placed);
    cursor = b.maxX + dx + hh * uni(r, minGap, 0.4);
  }
  // translate into a canvas-like frame
  const ox = uni(r, 10, 40) - Math.min(...ptsOf(out).map(p => p.x));
  const oy = 80 - (Math.min(...ptsOf(out).map(p => p.y)) + Math.max(...ptsOf(out).map(p => p.y))) / 2;
  return { strokes: place(out, p => ({ x: p.x + ox, y: p.y + oy })), pen };
}
