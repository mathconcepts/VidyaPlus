import type { CharGroup, Stroke } from './types';
import { CLASSES, INPUT_SIZE } from './types';
import { segmentStrokes } from './segment';
import { rasterizeChar } from './rasterize';
import { decode, type Decoded } from './decode';

type TF = typeof import('@tensorflow/tfjs-core');
type T4 = import('@tensorflow/tfjs-core').Tensor4D;
type T2 = import('@tensorflow/tfjs-core').Tensor2D;
type T = import('@tensorflow/tfjs-core').Tensor;

export interface TensorEntry { name: string; shape: number[]; dtype: 'uint8' | 'float32'; offset: number; min?: number; scale?: number }
export interface WeightsManifest { version: 1; classes: string; input: number[]; tensors: TensorEntry[] }

/** Maps a batch of 28x28 glyph images to class probabilities (length 12 each). */
export type Classifier = (images: Float32Array[]) => Promise<Float32Array[]>;

/** A recogniser turns raw pad strokes into a proposed string. The student confirms it. */
export type Recognizer = (strokes: Stroke[], penPx: number) => Promise<Decoded>;

export function readWeights(manifest: WeightsManifest, bin: ArrayBuffer): Map<string, { shape: number[]; data: Float32Array }> {
  if (manifest.version !== 1 || manifest.classes !== CLASSES) throw new Error('handwriting model: unexpected manifest');
  const out = new Map<string, { shape: number[]; data: Float32Array }>();
  for (const t of manifest.tensors) {
    const n = t.shape.reduce((a, b) => a * b, 1);
    let data: Float32Array;
    if (t.dtype === 'uint8') {
      const q = new Uint8Array(bin, t.offset, n);
      data = new Float32Array(n);
      for (let i = 0; i < n; i++) data[i] = (t.min ?? 0) + q[i] * (t.scale ?? 1);
    } else {
      const dv = new DataView(bin, t.offset, n * 4);
      data = new Float32Array(n);
      for (let i = 0; i < n; i++) data[i] = dv.getFloat32(i * 4, true);
    }
    out.set(t.name, { shape: t.shape, data });
  }
  return out;
}

/**
 * Build the small CNN out of TF.js ops: [conv3x3(24) - conv3x3(32) - pool] - [conv3x3(48) -
 * conv3x3(64) - pool] - dense(64) - dense(12) - softmax. Layout matches tools/handwriting/train.py.
 * Only core ops are used: no model-graph parser, nothing that needs eval.
 */
export function buildClassifier(tf: TF, manifest: WeightsManifest, bin: ArrayBuffer): Classifier {
  const w = readWeights(manifest, bin);
  const get = (name: string) => {
    const e = w.get(name);
    if (!e) throw new Error(`handwriting model: missing ${name}`);
    return tf.tensor(e.data, e.shape);
  };
  const p = {
    c1k: get('conv1/k'), c1b: get('conv1/b'), c2k: get('conv2/k'), c2b: get('conv2/b'),
    c3k: get('conv3/k'), c3b: get('conv3/b'), c4k: get('conv4/k'), c4b: get('conv4/b'),
    f1k: get('fc1/k'), f1b: get('fc1/b'), f2k: get('fc2/k'), f2b: get('fc2/b'),
  };
  const conv = (x: T, k: T, b: T): T => tf.relu(tf.add(tf.conv2d(x as T4, k as T4, 1, 'valid'), b));
  return async images => {
    const flat = new Float32Array(images.length * INPUT_SIZE * INPUT_SIZE);
    images.forEach((im, i) => flat.set(im, i * INPUT_SIZE * INPUT_SIZE));
    const probs = tf.tidy(() => {
      let x: T = tf.tensor4d(flat, [images.length, INPUT_SIZE, INPUT_SIZE, 1]);
      x = tf.maxPool(conv(conv(x, p.c1k, p.c1b), p.c2k, p.c2b) as T4, 2, 2, 'valid');
      x = tf.maxPool(conv(conv(x, p.c3k, p.c3b), p.c4k, p.c4b) as T4, 2, 2, 'valid');
      x = tf.reshape(x, [images.length, -1]);
      x = tf.relu(tf.add(tf.matMul(x as T2, p.f1k as T2), p.f1b));
      x = tf.add(tf.matMul(x as T2, p.f2k as T2), p.f2b);
      return tf.softmax(x);
    });
    const data = (await probs.data()) as Float32Array;
    probs.dispose();
    return images.map((_, i) => data.slice(i * CLASSES.length, (i + 1) * CLASSES.length));
  };
}

/**
 * Test-time variants of one character: the strokes as drawn plus small rotations
 * and shears about the glyph centre. The class probabilities are averaged, which
 * settles close calls (a 5 against a 3) without any extra model weights.
 */
export function variants(g: CharGroup): Stroke[][] {
  const cx = (g.box.minX + g.box.maxX) / 2, cy = (g.box.minY + g.box.maxY) / 2;
  const tf = (rot: number, shear: number): Stroke[] => {
    const c = Math.cos(rot), s = Math.sin(rot);
    return g.strokes.map(st => st.map(p => {
      const x = p.x - cx, y = p.y - cy;
      const xs = x + shear * y;
      return { x: cx + xs * c - y * s, y: cy + xs * s + y * c };
    }));
  };
  return [g.strokes, tf(0.12, 0), tf(-0.12, 0), tf(0, 0.2), tf(0, -0.2)];
}

/** The whole pipeline: strokes -> characters -> glyph images -> classes -> string. */
export function makeRecognizer(classify: Classifier, tta = true): Recognizer {
  return async (strokes, penPx) => {
    const groups = segmentStrokes(strokes);
    if (groups.length === 0) return { text: '', chars: [] };
    const per = groups.map(g => (tta ? variants(g) : [g.strokes]));
    const k = per[0].length;
    const out = await classify(per.flatMap(vs => vs.map(v => rasterizeChar(v, penPx))));
    const probs = groups.map((_, i) => {
      const avg = new Float32Array(CLASSES.length);
      for (let j = 0; j < k; j++) out[i * k + j].forEach((p, c) => { avg[c] += p / k; });
      return avg;
    });
    return decode(groups, probs);
  };
}
