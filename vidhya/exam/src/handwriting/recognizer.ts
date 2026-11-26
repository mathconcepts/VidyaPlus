/**
 * Loads the handwriting model on demand (T31, E2). This file is only ever
 * reached through a dynamic import from the pad, so TF.js and the weights stay
 * out of the first-load budget. Backends: WebGL, falling back to plain CPU.
 * Neither compiles JavaScript at run time (WebGL compiles GLSL shaders on the
 * GPU), so the page's CSP script-src 'self' stays as it is. The WASM backend is
 * deliberately not used: it needs 'wasm-unsafe-eval'.
 */
import { buildClassifier, makeRecognizer, type Recognizer, type WeightsManifest } from './model';

let cached: Promise<Recognizer> | null = null;

export function loadRecognizer(base: string = import.meta.env.BASE_URL): Promise<Recognizer> {
  if (!cached) {
    cached = load(base).catch(e => { cached = null; throw e; });
  }
  return cached;
}

async function load(base: string): Promise<Recognizer> {
  const [tf, , , manifest, bin] = await Promise.all([
    import('@tensorflow/tfjs-core'),
    import('@tensorflow/tfjs-backend-cpu'),
    import('@tensorflow/tfjs-backend-webgl'),
    fetch(`${base}handwriting/weights.json`).then(r => { if (!r.ok) throw new Error('model manifest'); return r.json() as Promise<WeightsManifest>; }),
    fetch(`${base}handwriting/weights.bin`).then(r => { if (!r.ok) throw new Error('model weights'); return r.arrayBuffer(); }),
  ]);
  const ok = await tf.setBackend('webgl').catch(() => false);
  if (!ok) await tf.setBackend('cpu');
  await tf.ready();
  return makeRecognizer(buildClassifier(tf, manifest, bin));
}
