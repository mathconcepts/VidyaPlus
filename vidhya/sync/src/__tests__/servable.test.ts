import { describe, expect, it, vi } from 'vitest';
import { HttpServableSource } from '../servable.js';
import { mcq } from './fixtures.js';

const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe('HttpServableSource', () => {
  it('asks for pool=practice&type=MCQ,MSQ with the bearer and parses the body', async () => {
    const f = ok({ pack_version: '0.0.1', items: [mcq('syn-001')] });
    const src = new HttpServableSource('http://brain:7000', 'sekrit', f);
    const r = await src.fetch({ pool: 'practice', types: ['MCQ', 'MSQ'], version: '0.0.1' });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/v1/servable');
    expect(url.searchParams.get('pool')).toBe('practice');
    expect(url.searchParams.get('type')).toBe('MCQ,MSQ');
    expect(url.searchParams.get('version')).toBe('0.0.1');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sekrit');
    expect(r.packVersion).toBe('0.0.1');
    expect(r.items).toHaveLength(1);
  });

  it('maps a network failure and a non-2xx to BrainUnavailable', async () => {
    const down = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(new HttpServableSource('http://x', undefined, down).fetch({ pool: 'practice', types: ['MCQ'] })).rejects.toThrow(/BrainUnavailable/);
    const bad = vi.fn(async () => new Response('no', { status: 503 })) as unknown as typeof fetch;
    await expect(new HttpServableSource('http://x', undefined, bad).fetch({ pool: 'practice', types: ['MCQ'] })).rejects.toThrow(/BrainUnavailable/);
  });

  it('rejects a body that is not {pack_version, items}', async () => {
    await expect(new HttpServableSource('http://x', undefined, ok({ items: [] })).fetch({ pool: 'practice', types: ['MCQ'] })).rejects.toThrow(/ServableContractBroken/);
  });
});
