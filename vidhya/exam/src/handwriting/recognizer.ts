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

/**
 * The weights as raw bytes. Some static hosts (the demo's artifact host among them) will not serve a
 * `.bin` file, so a base64 copy `weights.b64.txt` is the fallback; production serves the `.bin`.
 */
async function loadWeights(base: string): Promise<ArrayBuffer> {
  const r = await fetch(`${base}handwriting/weights.bin`).catch(() => undefined);
  if (r?.ok) return r.arrayBuffer();
  const t = await fetch(`${base}handwriting/weights.b64.txt`);
  if (!t.ok) throw new Error('model weights');
  const s = atob((await t.text()).trim());
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

async function load(base: string): Promise<Recognizer> {
  const [tf, , , manifest, bin] = await Promise.all([
    import('@tensorflow/tfjs-core'),
    import('@tensorflow/tfjs-backend-cpu'),
    import('@tensorflow/tfjs-backend-webgl'),
    fetch(`${base}handwriting/weights.json`).then(r => { if (!r.ok) throw new Error('model manifest'); return r.json() as Promise<WeightsManifest>; }),
    loadWeights(base),
  ]);
  const ok = await tf.setBackend('webgl').catch(() => false);
  if (!ok) await tf.setBackend('cpu');
  await tf.ready();
  return makeRecognizer(buildClassifier(tf, manifest, bin));
}
