import { readFile } from 'node:fs/promises';
import { SyncError } from './errors.js';
import type { ServableQuery, ServableResponse, ServableSource } from './types.js';

function shape(raw: unknown): { packVersion: string; items: ServableResponse['items'] } {
  const o = raw as Partial<ServableResponse> | null;
  if (!o || typeof o.pack_version !== 'string' || !Array.isArray(o.items)) {
    throw new SyncError('ServableContractBroken', '/v1/servable must answer {pack_version: string, items: Item[]}');
  }
  return { packVersion: o.pack_version, items: o.items };
}

/** GET {base}/v1/servable?pool=practice&type=MCQ,MSQ with the brain's bearer secret. */
export class HttpServableSource implements ServableSource {
  constructor(
    private readonly base: string,
    private readonly bearer: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetch(q: ServableQuery) {
    const url = new URL('/v1/servable', this.base);
    url.searchParams.set('pool', q.pool);
    url.searchParams.set('type', q.types.join(','));
    if (q.version) url.searchParams.set('version', q.version);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: this.bearer ? { authorization: `Bearer ${this.bearer}` } : {} });
    } catch (e) {
      throw new SyncError('BrainUnavailable', `cannot reach the brain at ${this.base}: ${(e as Error).message}`);
    }
    if (!res.ok) throw new SyncError('BrainUnavailable', `GET /v1/servable answered HTTP ${res.status}`);
    return shape(await res.json());
  }
}

/** A JSON file in the /v1/servable body shape: fixtures, and offline runs. */
export class FileServableSource implements ServableSource {
  constructor(private readonly path: string) {}
  async fetch(_q: ServableQuery) {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (e) {
      throw new SyncError('BrainUnavailable', `cannot read servable file ${this.path}: ${(e as Error).message}`);
    }
    return shape(JSON.parse(text));
  }
}
