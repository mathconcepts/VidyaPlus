import type { CharGroup, Stroke } from './types';
import { INPUT_SIZE } from './types';

/**
 * Draw one character's strokes into a 28x28 grayscale image the way MNIST
 * digits are prepared: the glyph (stroke points grown by half the pen) is scaled
 * to fit a 20x20 box keeping its shape, drawn with an anti-aliased round pen,
 * then shifted so its centre of mass sits at (14,14). Pure arithmetic, no canvas,
 * so the browser, the tests and the training tool produce identical pixels.
 * A dot therefore becomes a filled blob and a minus a thin horizontal bar.
 */
export function rasterizeChar(strokes: Stroke[], penPx: number): Float32Array {
  const N = INPUT_SIZE;
  const img = new Float32Array(N * N);
  const pts = strokes.flat();
  if (pts.length === 0) return img;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const pen = Math.max(penPx, 1);
  const w = maxX - minX + pen, h = maxY - minY + pen;
  const scale = 20 / Math.max(w, h);
  const thick = Math.min(20, Math.max(2.2, pen * scale));
  const cx0 = (minX + maxX) / 2, cy0 = (minY + maxY) / 2;
  const draw = (dx: number, dy: number) => {
    img.fill(0);
    const tx = (x: number) => (x - cx0) * scale + N / 2 + dx;
    const ty = (y: number) => (y - cy0) * scale + N / 2 + dy;
    const r = thick / 2;
    for (const s of strokes) {
      if (s.length === 0) continue;
      if (s.length === 1) { stamp(img, tx(s[0].x), ty(s[0].y), tx(s[0].x), ty(s[0].y), r); continue; }
      for (let i = 1; i < s.length; i++) stamp(img, tx(s[i - 1].x), ty(s[i - 1].y), tx(s[i].x), ty(s[i].y), r);
    }
  };
  draw(0, 0);
  let m = 0, mx = 0, my = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const v = img[y * N + x]; m += v; mx += v * x; my += v * y; }
  if (m > 0) draw(N / 2 - 0.5 - mx / m, N / 2 - 0.5 - my / m);
  return img;
}

export function rasterizeGroup(g: CharGroup, penPx: number): Float32Array {
  return rasterizeChar(g.strokes, penPx);
}

/** Anti-aliased capsule from (x0,y0) to (x1,y1), radius r, max-blended into img. */
function stamp(img: Float32Array, x0: number, y0: number, x1: number, y1: number, r: number): void {
  const N = INPUT_SIZE;
  const lo = (a: number, b: number) => Math.max(0, Math.floor(Math.min(a, b) - r - 1));
  const hi = (a: number, b: number) => Math.min(N - 1, Math.ceil(Math.max(a, b) + r + 1));
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
  for (let y = lo(y0, y1); y <= hi(y0, y1); y++) {
    for (let x = lo(x0, x1); x <= hi(x0, x1); x++) {
      const px = x, py = y;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
      const d = Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
      const v = Math.max(0, Math.min(1, r - d + 0.5));
      if (v > img[y * N + x]) img[y * N + x] = v;
    }
  }
}
