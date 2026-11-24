import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sympyEquivalent, evaluateScript, requireSympy, __testing } from '../sympy.js';
import { isBrainError } from '../../errors.js';

function hasSympy(): boolean {
  try {
    execFileSync('python3', ['-I', '-c', 'import sympy'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const live = hasSympy() ? describe : describe.skip;

live('sympy engine (live subprocess)', () => {
  it('equal expressions agree', async () => {
    expect(await sympyEquivalent('sin(x)**2 + cos(x)**2', '1')).toMatchObject({ kind: 'ok', agrees: true });
  });
  it('a distractor that equals the key is caught (O4 gate)', async () => {
    expect(await sympyEquivalent('2/4', '1/2')).toMatchObject({ kind: 'ok', agrees: true });
    expect(await sympyEquivalent('x + 1', 'x - 1')).toMatchObject({ kind: 'ok', agrees: false });
  });
  it('unparseable input names its head, never agrees', async () => {
    expect(await sympyEquivalent('find the eigenvalues of (', '2')).toMatchObject({ kind: 'unparseable' });
  });
  it('evaluateScript returns the value the item script recomputes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'brain-sympy-'));
    const p = path.join(dir, 'item.py');
    writeFileSync(p, 'import json, sympy\nM = sympy.Matrix([[2,1],[1,2]])\nprint(json.dumps({"value": float(max(M.eigenvals()))}))\n');
    expect(await evaluateScript(p)).toEqual({ kind: 'value', value: 3 });
  });
  it('a script that crashes is an error, not a value', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'brain-sympy-'));
    const p = path.join(dir, 'bad.py');
    writeFileSync(p, 'raise SystemExit(2)\n');
    expect((await evaluateScript(p)).kind).toBe('error');
  });
  it('requireSympy passes when sympy works', async () => {
    await expect(requireSympy()).resolves.toBeUndefined();
  });
});

describe('sympy engine without python', () => {
  it('a missing python3 is unavailable, and requireSympy throws SympyUnavailable', async () => {
    const restore = __testing.setPythonBin('/nonexistent/python3');
    try {
      expect(await sympyEquivalent('1', '1')).toMatchObject({ kind: 'unavailable' });
      const err = await requireSympy().catch((e: unknown) => e);
      expect(isBrainError(err, 'SympyUnavailable')).toBe(true);
    } finally {
      restore();
    }
  });
});
