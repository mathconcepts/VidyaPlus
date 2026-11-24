import { describe, it, expect } from 'vitest';
import { wolframValue, parseWolframNumber } from '../wolfram.js';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}
const pods = (...p: [string, string][]) => ({ queryresult: { success: true, error: false, pods: p.map(([id, t]) => ({ id, subpods: [{ plaintext: t }] })) } });

describe('parseWolframNumber', () => {
  it.each([
    ['0.75', 0.75], ['-2.5', -2.5], ['3/4', 0.75], ['−1/2', -0.5], ['1.23×10^-5', 1.23e-5], ['≈1.41421…', 1.41421], ['42', 42],
  ])('%s → %d', (t, v) => expect(parseWolframNumber(t)).toBeCloseTo(v, 12));
  it.each(['x = 2', '1, 2', 'pi', '', '1/0', '1,000'])('refuses %j', (t) => expect(parseWolframNumber(t)).toBeUndefined());
  it('12 is never read as 2 (the legacy substring match)', () => expect(parseWolframNumber('12')).toBe(12));
});

describe('wolframValue', () => {
  it('prefers the decimal approximation', async () => {
    const o = await wolframValue('q', { appId: 'k', fetchImpl: fakeFetch(200, pods(['Result', '1/3'], ['DecimalApproximation', '0.333333…'])) });
    expect(o).toMatchObject({ kind: 'value', pod: 'DecimalApproximation' });
  });
  it('falls back to the Result pod', async () => {
    expect(await wolframValue('q', { appId: 'k', fetchImpl: fakeFetch(200, pods(['Result', '-4'])) })).toMatchObject({ kind: 'value', value: -4 });
  });
  it('no app id is unavailable, not a disagreement', async () => {
    expect(await wolframValue('q', { appId: undefined })).toMatchObject({ kind: 'unavailable' });
  });
  it('success:false is no_result', async () => {
    expect(await wolframValue('q', { appId: 'k', fetchImpl: fakeFetch(200, { queryresult: { success: false, error: false } }) })).toMatchObject({ kind: 'no_result' });
  });
  it('an equation-only answer is no_result', async () => {
    expect(await wolframValue('q', { appId: 'k', fetchImpl: fakeFetch(200, pods(['Solution', 'x = 2'])) })).toMatchObject({ kind: 'no_result' });
  });
  it('HTTP 429 and a limit message are quota', async () => {
    expect(await wolframValue('q', { appId: 'k', fetchImpl: fakeFetch(429, {}) })).toMatchObject({ kind: 'quota' });
    expect(await wolframValue('q', { appId: 'k', fetchImpl: fakeFetch(200, { queryresult: { error: { msg: 'Monthly limit exceeded' } } }) })).toMatchObject({ kind: 'quota' });
  });
  it('HTTP 403 and a network error are unavailable', async () => {
    expect(await wolframValue('q', { appId: 'k', fetchImpl: fakeFetch(403, {}) })).toMatchObject({ kind: 'unavailable' });
    const boom = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    expect(await wolframValue('q', { appId: 'k', fetchImpl: boom })).toMatchObject({ kind: 'unavailable', detail: 'ECONNRESET' });
  });
});
