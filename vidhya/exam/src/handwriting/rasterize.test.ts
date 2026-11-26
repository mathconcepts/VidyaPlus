import { describe, it, expect } from 'vitest';
import { rasterizeChar } from './rasterize';
import { decode } from './decode';
import { segmentStrokes } from './segment';
import { CLASSES } from './types';

const sum = (im: Float32Array) => im.reduce((a, b) => a + b, 0);
function com(im: Float32Array) {
  let m = 0, x = 0, y = 0;
  im.forEach((v, i) => { m += v; x += v * (i % 28); y += v * Math.floor(i / 28); });
  return { x: x / m, y: y / m };
}
const L = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y1 }];

describe('rasterizeChar', () => {
  it('is 28x28, deterministic, and values stay in 0..1', () => {
    const a = rasterizeChar([L(0, 0, 50, 90)], 5), b = rasterizeChar([L(0, 0, 50, 90)], 5);
    expect(a).toHaveLength(784);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Math.max(...a)).toBeLessThanOrEqual(1);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
  });
  it('centres the ink on (13.5, 13.5) whatever the position and size on the canvas', () => {
    for (const [dx, dy, k] of [[0, 0, 1], [300, 120, 2], [40, 7, 0.5]]) {
      const c = com(rasterizeChar([L(dx, dy, dx + 30 * k, dy + 80 * k), L(dx + 30 * k, dy + 80 * k, dx + 60 * k, dy)], 5));
      expect(c.x).toBeCloseTo(13.5, 0);
      expect(c.y).toBeCloseTo(13.5, 0);
    }
  });
  it('a lone tap is a filled blob; a minus is a thin wide bar', () => {
    const dot = rasterizeChar([[{ x: 10, y: 10 }]], 5);
    const bar = rasterizeChar([L(0, 50, 80, 50)], 5);
    expect(sum(dot)).toBeGreaterThan(200);
    const rows = (im: Float32Array) => { const r = new Set<number>(), c = new Set<number>(); im.forEach((v, i) => { if (v > 0.5) { r.add(Math.floor(i / 28)); c.add(i % 28); } }); return [r.size, c.size]; };
    const [br, bc] = rows(bar);
    expect(bc).toBeGreaterThanOrEqual(18);
    expect(br).toBeLessThanOrEqual(4);
  });
  it('no strokes gives a blank image', () => {
    expect(sum(rasterizeChar([], 5))).toBe(0);
  });
});

describe('decode (geometry narrows the classes)', () => {
  const one = (c: string) => { const p = new Array(12).fill(0.01); p[CLASSES.indexOf(c)] = 0.9; return p; };
  const strokes = [L(0, 40, 30, 40), L(60, 0, 60, 80), [{ x: 100, y: 78 }], L(140, 0, 170, 80)];
  it('short groups can only be "." or "-", tall ones only digits', () => {
    const groups = segmentStrokes(strokes);
    // The network wrongly votes digits for the short groups and "." for a tall one: geometry corrects the class family.
    const probs = [one('1'), one('.'), one('2'), one('7')];
    const d = decode(groups, probs);
    expect(d.text[0]).toMatch(/[.-]/);
    expect(d.text[1]).toMatch(/\d/);
    expect(d.text[2]).toMatch(/[.-]/);
    expect(d.text[3]).toBe('7');
  });
  it('a lone character may be any class', () => {
    expect(decode(segmentStrokes([L(0, 0, 40, 0)]), [one('-')]).text).toBe('-');
  });
});
