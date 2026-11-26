import { describe, it, expect } from 'vitest';
import { segmentStrokes } from './segment';
import type { Stroke } from './types';

const line = (x0: number, y0: number, x1: number, y1: number): Stroke => [{ x: x0, y: y0 }, { x: x1, y: y1 }];

describe('segmentStrokes (T31)', () => {
  it('nothing drawn gives no characters', () => {
    expect(segmentStrokes([])).toEqual([]);
    expect(segmentStrokes([[]])).toEqual([]);
  });

  it('splits at horizontal gaps and returns characters left to right, whatever the stroke order', () => {
    const a = line(100, 0, 100, 80), b = line(10, 0, 40, 80), c = line(200, 0, 230, 80);
    const g = segmentStrokes([a, c, b]);
    expect(g).toHaveLength(3);
    expect(g.map(x => Math.round(x.box.minX))).toEqual([10, 100, 200]);
  });

  it('keeps the strokes of one character together when their x-ranges overlap (a 4, a 5 with its bar)', () => {
    const five = [line(10, 40, 50, 40), line(20, 0, 60, 0), line(15, 0, 15, 40)];
    expect(segmentStrokes(five)).toHaveLength(1);
    expect(segmentStrokes(five)[0].strokes).toHaveLength(3);
  });

  it('a minus, a dot and digits are separate characters with a clear gap', () => {
    const minus = line(0, 40, 30, 40), three = line(60, 0, 100, 80);
    const dot: Stroke = [{ x: 140, y: 78 }];
    const five = line(180, 0, 220, 80);
    const g = segmentStrokes([minus, three, dot, five]);
    expect(g).toHaveLength(4);
    expect(g[2].strokes).toEqual([dot]);
  });

  it('a single tap is a character of its own', () => {
    expect(segmentStrokes([[{ x: 5, y: 5 }]])).toHaveLength(1);
  });
});
