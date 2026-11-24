/**
 * B2 SymPy engine (offline only, plan R4). Ported from legacy
 * `src/verification/verifiers/sympy.ts`: same subprocess approach, same
 * refusal discipline (unparseable, timeout and unavailable are outcomes,
 * never a guessed agreement).
 *
 * What the port adds:
 *   - `evaluateScript` runs an item's authored SymPy script, which
 *     recomputes the answer from the stem's own data (ENG-0 rule) and
 *     prints one JSON line `{"value": <number>}`.
 *   - `requireSympy` throws `SympyUnavailable`, so a box without python3 or
 *     sympy stops loudly instead of passing items.
 * `tiered-orchestrator.ts` is not ported (it pulls in the RAG VectorStore).
 * Never used to grade a live answer.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BrainError } from '../errors.js';

const run = promisify(execFile);

export const DEFAULT_SYMPY_TIMEOUT_MS = 10_000;

export type SympyOutcome =
  | { kind: 'ok'; agrees: boolean; canonical?: string }
  | { kind: 'value'; value: number }
  | { kind: 'unparseable'; head: string }
  | { kind: 'unavailable'; detail: string }
  | { kind: 'timeout' }
  | { kind: 'error'; detail: string };

/** Unchanged from legacy: compare two closed-form expressions with simplify(a - b) == 0. */
const EQUIV_SCRIPT = `
import sys, json, re

def head_of(raw):
    m = re.match(r"^\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*[\\[\\(]", raw)
    if m:
        return m.group(1)
    stripped = raw.strip()
    return stripped[:40] if stripped else "empty expression"

def main():
    expected_raw = sys.argv[1] if len(sys.argv) > 1 else ""
    candidate_raw = sys.argv[2] if len(sys.argv) > 2 else ""
    try:
        import sympy
        from sympy.parsing.sympy_parser import (
            parse_expr, standard_transformations, implicit_multiplication_application,
        )
    except Exception as e:
        print(json.dumps({"unavailable": True, "error": str(e)}))
        return
    transformations = standard_transformations + (implicit_multiplication_application,)
    def try_parse(raw):
        try:
            return parse_expr(raw, transformations=transformations, evaluate=True), None
        except Exception as e:
            return None, str(e)
    expected_expr, _ = try_parse(expected_raw)
    if expected_expr is None:
        print(json.dumps({"unparseable": True, "head": head_of(expected_raw)}))
        return
    candidate_expr, _ = try_parse(candidate_raw)
    if candidate_expr is None:
        print(json.dumps({"unparseable": True, "head": head_of(candidate_raw)}))
        return
    try:
        agrees = bool(sympy.simplify(expected_expr - candidate_expr) == 0)
    except Exception:
        try:
            agrees = bool(sympy.simplify(expected_expr) == sympy.simplify(candidate_expr))
        except Exception:
            print(json.dumps({"unparseable": True, "head": head_of(candidate_raw)}))
            return
    try:
        canonical = str(sympy.simplify(expected_expr))
    except Exception:
        canonical = str(expected_expr)
    print(json.dumps({"agrees": agrees, "canonical": canonical}))

main()
`;

interface Stdout {
  unavailable?: boolean;
  error?: string;
  unparseable?: boolean;
  head?: string;
  agrees?: boolean;
  canonical?: string;
  value?: unknown;
}

let pythonBin = 'python3';

async function runPython(args: string[], timeoutMs: number): Promise<SympyOutcome> {
  try {
    const { stdout } = await run(pythonBin, ['-I', ...args], { timeout: timeoutMs, killSignal: 'SIGKILL' });
    const line = stdout.trim().split('\n').pop() ?? '';
    if (!line) return { kind: 'error', detail: 'sympy subprocess produced no output' };
    let parsed: Stdout;
    try {
      parsed = JSON.parse(line) as Stdout;
    } catch {
      return { kind: 'error', detail: `non-JSON output: ${line.slice(0, 200)}` };
    }
    if (parsed.unavailable) return { kind: 'unavailable', detail: parsed.error || 'sympy not importable' };
    if (parsed.unparseable) return { kind: 'unparseable', head: parsed.head || 'expression' };
    if ('value' in parsed) {
      const v = typeof parsed.value === 'number' ? parsed.value : Number(parsed.value);
      return Number.isFinite(v) ? { kind: 'value', value: v } : { kind: 'error', detail: `script value is not a finite number: ${String(parsed.value)}` };
    }
    return { kind: 'ok', agrees: !!parsed.agrees, canonical: parsed.canonical };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null; stderr?: string };
    if (e.killed || e.signal === 'SIGKILL' || e.signal === 'SIGTERM') return { kind: 'timeout' };
    if (e.code === 'ENOENT') return { kind: 'unavailable', detail: `${pythonBin} not found on PATH` };
    if (typeof e.stderr === 'string' && /ModuleNotFoundError: No module named 'sympy'/.test(e.stderr)) {
      return { kind: 'unavailable', detail: 'sympy not importable' };
    }
    return { kind: 'error', detail: (e.stderr || e.message || 'unknown failure').slice(0, 300) };
  }
}

/** Are two closed-form expressions equal? Used by the K2 distractor-equivalence gate (O4). */
export function sympyEquivalent(expected: string, candidate: string, timeoutMs = DEFAULT_SYMPY_TIMEOUT_MS) {
  return runPython(['-c', EQUIV_SCRIPT, expected, candidate], timeoutMs);
}

/** Run an item's authored SymPy script. It must print `{"value": <number>}` as its last line. */
export function evaluateScript(scriptPath: string, timeoutMs = DEFAULT_SYMPY_TIMEOUT_MS) {
  return runPython([scriptPath], timeoutMs);
}

/** Throws SympyUnavailable unless python3 and sympy both work. Call before any batch. */
export async function requireSympy(timeoutMs = DEFAULT_SYMPY_TIMEOUT_MS): Promise<void> {
  const o = await sympyEquivalent('1', '1', timeoutMs);
  if (o.kind === 'ok') return;
  const detail = o.kind === 'unavailable' || o.kind === 'error' ? o.detail : o.kind;
  throw new BrainError('SympyUnavailable', detail);
}

export const __testing = {
  setPythonBin(bin: string): () => void {
    const prev = pythonBin;
    pythonBin = bin;
    return () => {
      pythonBin = prev;
    };
  },
};
