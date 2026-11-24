/**
 * B2 two-engine runner (plan D7, K3, K4). SymPy recomputes the value from the
 * item's own script; Wolfram answers a query written in a separate pass from
 * the raw stem. Both must agree with each other and with the key, within the
 * exam.yaml tolerance, before an item is `verified`.
 *
 *   both numbers, all agree        → verified
 *   both numbers, any mismatch     → disagree  (quarantine + Giri queue)
 *   anything else                  → pending   (retry; never verified, never disagree)
 */
import type { SympyOutcome } from './sympy.js';
import type { WolframOutcome } from './wolfram.js';

export interface Tolerance {
  /** |a − b| ≤ rel × max(1, |a|) */
  rel: number;
}

export interface EngineRecord {
  name: 'sympy' | 'wolfram';
  value?: number;
  outcome: string;
  detail?: string;
}

export type Verdict =
  | { status: 'verified'; engines: EngineRecord[] }
  | { status: 'disagree'; engines: EngineRecord[]; reason: string }
  | { status: 'pending'; engines: EngineRecord[]; reason: string };

export function close(a: number, b: number, tol: Tolerance): boolean {
  return Math.abs(a - b) <= tol.rel * Math.max(1, Math.abs(a));
}

function sympyRecord(o: SympyOutcome): EngineRecord {
  if (o.kind === 'value') return { name: 'sympy', value: o.value, outcome: 'value' };
  const detail = 'detail' in o ? o.detail : 'head' in o ? o.head : undefined;
  return { name: 'sympy', outcome: o.kind, ...(detail ? { detail } : {}) };
}

function wolframRecord(o: WolframOutcome): EngineRecord {
  if (o.kind === 'value') return { name: 'wolfram', value: o.value, outcome: 'value', detail: `${o.pod}: ${o.plaintext}` };
  return { name: 'wolfram', outcome: o.kind, detail: o.detail };
}

export function decide(key: number, sympy: SympyOutcome, wolfram: WolframOutcome, tol: Tolerance): Verdict {
  const engines = [sympyRecord(sympy), wolframRecord(wolfram)];
  if (sympy.kind !== 'value' || wolfram.kind !== 'value') {
    const missing = engines.filter((e) => e.outcome !== 'value').map((e) => `${e.name} ${e.outcome}`);
    return { status: 'pending', engines, reason: missing.join(', ') };
  }
  const s = sympy.value;
  const w = wolfram.value;
  if (!close(s, w, tol)) return { status: 'disagree', engines, reason: `sympy ${s} ≠ wolfram ${w}` };
  if (!close(key, s, tol)) return { status: 'disagree', engines, reason: `key ${key} ≠ engines ${s}` };
  return { status: 'verified', engines };
}
