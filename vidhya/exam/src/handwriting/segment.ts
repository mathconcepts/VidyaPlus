import type { Box, CharGroup, Stroke } from './types';

export function strokeBox(s: Stroke): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of s) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function union(a: Box, b: Box): Box {
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

/**
 * Split strokes into characters by horizontal extent: strokes whose x-ranges
 * overlap (a "4" drawn in two strokes, a "5" with a separate bar) belong to one
 * character; a clear horizontal gap starts a new one. Characters come back left
 * to right. `touch` is how much two ranges may sit apart and still merge,
 * as a fraction of the tallest stroke group (default 5%).
 */
export function segmentStrokes(strokes: Stroke[], touch = 0.05): CharGroup[] {
  const live = strokes.filter(s => s.length > 0);
  if (live.length === 0) return [];
  const items = live.map(s => ({ s, b: strokeBox(s) })).sort((a, b) => a.b.minX - b.b.minX);
  const refH = Math.max(1, ...items.map(i => i.b.maxY - i.b.minY));
  const tol = touch * refH;
  const groups: CharGroup[] = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && it.b.minX <= last.box.maxX + tol) {
      last.strokes.push(it.s);
      last.box = union(last.box, it.b);
    } else {
      groups.push({ strokes: [it.s], box: it.b });
    }
  }
  return groups;
}
