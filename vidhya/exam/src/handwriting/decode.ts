import type { CharGroup } from './types';
import { CLASSES } from './types';

export interface Decoded { text: string; chars: { ch: string; p: number }[] }

/**
 * Turn per-character class probabilities into a string. Geometry narrows the
 * choice before the network's vote counts: among several written characters, a
 * short group (under 45% of the tallest) can only be "." or "-"; a tall group
 * can only be a digit. A lone group may be any class. The result is only a
 * proposal: the student confirms it, and tryParseNat still judges it.
 */
export function decode(groups: CharGroup[], probs: ArrayLike<number>[]): Decoded {
  const ref = Math.max(1e-6, ...groups.map(g => g.box.maxY - g.box.minY));
  const chars = groups.map((g, i) => {
    const h = g.box.maxY - g.box.minY;
    const small = groups.length > 1 && h < 0.45 * ref;
    let best = -1, bp = -1;
    for (let c = 0; c < CLASSES.length; c++) {
      const isSym = c >= 10;
      if (groups.length > 1 && small !== isSym) continue;
      if (probs[i][c] > bp) { bp = probs[i][c]; best = c; }
    }
    return { ch: CLASSES[best < 0 ? 0 : best], p: bp };
  });
  return { text: chars.map(c => c.ch).join(''), chars };
}
