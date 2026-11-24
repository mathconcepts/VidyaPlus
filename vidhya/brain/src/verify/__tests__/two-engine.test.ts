import { describe, it, expect } from 'vitest';
import { decide, close } from '../two-engine.js';
import type { SympyOutcome } from '../sympy.js';
import type { WolframOutcome } from '../wolfram.js';

const tol = { rel: 1e-6 };
const s = (value: number): SympyOutcome => ({ kind: 'value', value });
const w = (value: number): WolframOutcome => ({ kind: 'value', value, pod: 'Result', plaintext: String(value) });

describe('two-engine runner', () => {
  it('both engines and the key agree → verified', () => {
    expect(decide(3, s(3), w(3.0000001), tol).status).toBe('verified');
  });
  it('engines disagree → disagree', () => {
    expect(decide(3, s(3), w(2), tol)).toMatchObject({ status: 'disagree', reason: 'sympy 3 ≠ wolfram 2' });
  });
  it('engines agree but the key is wrong → disagree', () => {
    expect(decide(4, s(3), w(3), tol)).toMatchObject({ status: 'disagree', reason: 'key 4 ≠ engines 3' });
  });
  it.each<[string, SympyOutcome, WolframOutcome]>([
    ['wolfram unavailable', s(3), { kind: 'unavailable', detail: 'HTTP 503' }],
    ['wolfram quota', s(3), { kind: 'quota', detail: 'HTTP 429' }],
    ['wolfram no result', s(3), { kind: 'no_result', detail: 'x' }],
    ['sympy unavailable', { kind: 'unavailable', detail: 'no python' }, w(3)],
    ['sympy timeout', { kind: 'timeout' }, w(3)],
  ])('%s → pending, never verified or disagree', (_n, so, wo) => {
    expect(decide(3, so, wo, tol).status).toBe('pending');
  });
  it('tolerance is relative above 1 and absolute below 1', () => {
    expect(close(1e6, 1e6 + 0.5, tol)).toBe(true);
    expect(close(1e-9, 2e-9, tol)).toBe(true);
    expect(close(0.5, 0.5001, tol)).toBe(false);
  });
  it('records both engines on the receipt', () => {
    const v = decide(3, s(3), w(3), tol);
    expect(v.engines.map((e) => e.name)).toEqual(['sympy', 'wolfram']);
  });
});
