#!/usr/bin/env python3
"""Step 1. MNIST images -> pen strokes (human digit shapes as polylines).

The pad hands the recogniser strokes, not pixels, so the training digits and the
held-out evaluation digits are both turned into strokes the same way: binarise,
skeletonise, walk the skeleton into polylines, simplify. Output coordinates are
in the 28x28 image frame, one JSON list of strokes per image.

Usage: extract_strokes.py <mnist-dir> <out-dir>
MNIST files: the four *-idx*-ubyte.gz files (checked against known SHA-256).
"""
import gzip, hashlib, json, sys
from pathlib import Path
import numpy as np
from skimage.morphology import skeletonize

SHA = {
    'train-images-idx3-ubyte.gz': '440fcabf73cc546fa21475e81ea370265605f56be210a4024d2ca8f203523609',
    'train-labels-idx1-ubyte.gz': '3552534a0a558bbed6aed32b30c495cca23d567ec52cac8be1a0730e8010255c',
    't10k-images-idx3-ubyte.gz': '8d422c7b0a1c1c79245a5bcf07fe86e33eeafee792b84584aec276f5a2dbc4e6',
    't10k-labels-idx1-ubyte.gz': 'f7ae60f92e00ec6debd23a6088c31dbd2371eca3ffa0defaefb259924204aec6',
}

def load(d: Path, name: str, image: bool):
    raw = (d / name).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == SHA[name], f'{name}: unexpected checksum'
    data = gzip.decompress(raw)
    return (np.frombuffer(data, np.uint8, offset=16).reshape(-1, 28, 28) if image
            else np.frombuffer(data, np.uint8, offset=8))

NB = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]

def trace(img):
    sk = skeletonize(img > 90)
    pix = {(int(y), int(x)) for y, x in zip(*np.nonzero(sk))}
    nbrs = {p: [(p[0] + dy, p[1] + dx) for dy, dx in NB if (p[0] + dy, p[1] + dx) in pix] for p in pix}
    seen, strokes = set(), []
    def walk(start):
        path, cur, prev_dir = [start], start, None
        seen.add(start)
        while True:
            cand = [q for q in nbrs[cur] if q not in seen]
            if not cand: break
            def cost(q):
                d = (q[0] - cur[0], q[1] - cur[1])
                turn = 0 if prev_dir is None else abs(d[0] - prev_dir[0]) + abs(d[1] - prev_dir[1])
                return (turn, abs(d[0]) + abs(d[1]))
            q = min(cand, key=cost)
            prev_dir = (q[0] - cur[0], q[1] - cur[1])
            seen.add(q); path.append(q); cur = q
        # Join onto a stroke already drawn if the walk ended beside one, so strokes that meet really touch.
        mine = set(path)
        join = [q for q in nbrs[cur] if q in seen and q not in mine]
        if join and len(path) > 1: path.append(join[0])
        return path
    for start in sorted(p for p in pix if len(nbrs[p]) == 1):
        if start not in seen: strokes.append(walk(start))
    while len(seen) < len(pix):
        start = min(p for p in pix if p not in seen)
        path = walk(start)
        anchor = [q for q in nbrs[start] if q in seen and q not in path]
        if anchor: path.insert(0, anchor[0])
        strokes.append(path)
    out = [simplify([(float(x), float(y)) for y, x in s], 0.8) for s in strokes if len(s) >= 1]
    # Drop 1-2 pixel spurs the skeletoniser leaves on thick strokes; a person's pen would not make them.
    long_ = [s for s in out if sum(np.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(s, s[1:])) >= 3.0]
    return long_ or out

def simplify(pts, eps):
    if len(pts) < 3: return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    L = np.hypot(x1 - x0, y1 - y0)
    d = [abs((x1 - x0) * (y0 - y) - (x0 - x) * (y1 - y0)) / L if L else np.hypot(x - x0, y - y0) for x, y in pts]
    i = int(np.argmax(d))
    if d[i] <= eps: return [pts[0], pts[-1]]
    return simplify(pts[:i + 1], eps)[:-1] + simplify(pts[i:], eps)

def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    for split, imf, lbf in (('train', 'train-images-idx3-ubyte.gz', 'train-labels-idx1-ubyte.gz'),
                            ('test', 't10k-images-idx3-ubyte.gz', 't10k-labels-idx1-ubyte.gz')):
        imgs, lbls = load(src, imf, True), load(src, lbf, False)
        items = []
        for img, lb in zip(imgs, lbls):
            st = trace(img)
            if st: items.append({'d': int(lb), 's': [[[round(x, 1), round(y, 1)] for x, y in s] for s in st]})
        (out / f'strokes-{split}.json').write_text(json.dumps(items, separators=(',', ':')))
        print(split, len(items), 'digits traced')

if __name__ == '__main__':
    main()
