/**
 * B1 parity golden (plan B1): for every MCQ/MSQ case, the brain's `correct`
 * flag equals DeepTutor's own `answers.check_answer` (pinned upstream).
 * Marks are not compared: DeepTutor practice has no negative marking.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { scoreAttempt } from '../scorer.js';
import { GATE_LIKE } from './fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const brainRoot = path.resolve(here, '../../..');
const repoRoot = path.resolve(brainRoot, '../..');
const golden = JSON.parse(readFileSync(path.join(here, '../__fixtures__/deeptutor-parity-golden.json'), 'utf8')) as {
  cases: { kind: 'mcq' | 'msq'; key: number[]; sel: number[]; dt_correct: boolean | null }[];
};

describe('parity with DeepTutor practice grading', () => {
  it('golden covers both kinds and has no ungraded cases', () => {
    expect(golden.cases.filter((c) => c.kind === 'mcq').length).toBeGreaterThanOrEqual(16);
    expect(golden.cases.filter((c) => c.kind === 'msq').length).toBeGreaterThanOrEqual(30);
    expect(golden.cases.every((c) => typeof c.dt_correct === 'boolean')).toBe(true);
  });

  it.each(golden.cases.map((c, i) => [i, c] as const))('case %i matches', (_i, c) => {
    const options = ['A', 'B', 'C', 'D'];
    const g =
      c.kind === 'mcq'
        ? scoreAttempt({ id: 'p', kind: 'mcq', marks: 1, answerIndex: c.key[0], options }, { kind: 'mcq', selectedIndex: c.sel[0] }, GATE_LIKE)
        : scoreAttempt({ id: 'p', kind: 'msq', marks: 2, answerIndices: c.key, options }, { kind: 'msq', selectedIndices: c.sel }, GATE_LIKE);
    expect(g.correct).toBe(c.dt_correct);
  });

  it('the golden is current for the pinned DeepTutor (skipped without python3)', () => {
    let status = 0;
    try {
      execFileSync('python3', ['-I', path.join(brainRoot, 'scripts/gen-parity-golden.py'), repoRoot, '--check'], { stdio: 'pipe' });
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { status?: number };
      if (err.code === 'ENOENT') return;
      status = err.status ?? 1;
    }
    expect(status, 'DeepTutor grading changed: re-run scripts/gen-parity-golden.py and review the diff').toBe(0);
  });
});
