/**
 * B1 marking matrix, ported from legacy src/scoring/__tests__/deterministic-scorer.test.ts:
 * correct/wrong/skip × 1m/2m for MCQ; MSQ exact/subset/superset/refusal;
 * NAT range/boundary/epsilon/outside. Marking now comes from exam.yaml data.
 */
import { describe, it, expect } from 'vitest';
import { scoreAttempt, mcqPenalty, describeMarking, type ScorableItem } from '../scorer.js';
import { parseExamMarking } from '../../exam/marking.js';
import { isBrainError } from '../../errors.js';
import { GATE_LIKE as M } from './fixtures.js';

const mcq = (marks: number): ScorableItem => ({ id: 'q1', kind: 'mcq', marks, answerIndex: 1, options: ['A', 'B', 'C', 'D'] });
const msq = (marks = 2): ScorableItem => ({ id: 'q2', kind: 'msq', marks, answerIndices: [0, 2], options: ['A', 'B', 'C', 'D'] });
const nat = (range: [number, number] = [1.995, 2.005], marks = 1): ScorableItem => ({ id: 'q3', kind: 'nat', marks, answerRange: range });

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return isBrainError(e) ? e.code : 'not-a-brain-error';
  }
  return undefined;
}

describe('MCQ', () => {
  it('1-mark correct earns +1', () => {
    const g = scoreAttempt(mcq(1), { kind: 'mcq', selectedIndex: 1 }, M);
    expect(g).toMatchObject({ marks_awarded: 1, max: 1, correct: true });
  });
  it('1-mark wrong costs 1/3', () => {
    expect(scoreAttempt(mcq(1), { kind: 'mcq', selectedIndex: 0 }, M).marks_awarded).toBeCloseTo(-1 / 3, 12);
  });
  it('2-mark wrong costs 2/3', () => {
    expect(scoreAttempt(mcq(2), { kind: 'mcq', selectedIndex: 3 }, M).marks_awarded).toBeCloseTo(-2 / 3, 12);
  });
  it('skipped earns 0 and says so', () => {
    expect(scoreAttempt(mcq(2), { kind: 'mcq', skipped: true }, M)).toMatchObject({ marks_awarded: 0, skipped: true, correct: false });
  });
  it('an unlisted mark value falls back to marks / divisor', () => {
    expect(mcqPenalty(3, M)).toBeCloseTo(1, 12);
  });
  it('uses whatever the exam states, not GATE numbers', () => {
    const other = parseExamMarking({ ...M, mcq_negative: { '1': 0.25 } });
    expect(scoreAttempt(mcq(1), { kind: 'mcq', selectedIndex: 0 }, other).marks_awarded).toBeCloseTo(-0.25, 12);
  });
  it('refuses a kind mismatch, a malformed item and a missing selection', () => {
    expect(code(() => scoreAttempt(mcq(1), { kind: 'nat', value: 1 }, M))).toBe('InvalidResponse');
    expect(code(() => scoreAttempt({ id: 'x', kind: 'mcq', marks: 1 }, { kind: 'mcq', selectedIndex: 0 }, M))).toBe('InvalidItem');
    expect(code(() => scoreAttempt(mcq(1), { kind: 'mcq' }, M))).toBe('InvalidResponse');
  });
});

describe('MSQ', () => {
  it('exact set earns full marks, in any order', () => {
    expect(scoreAttempt(msq(), { kind: 'msq', selectedIndices: [2, 0] }, M)).toMatchObject({ marks_awarded: 2, correct: true });
  });
  it.each([[[0]], [[0, 1, 2]], [[1, 3]]])('selection %j earns 0, never negative', (sel) => {
    const g = scoreAttempt(msq(), { kind: 'msq', selectedIndices: sel }, M);
    expect(g.marks_awarded).toBe(0);
    expect(Object.is(g.marks_awarded, -0)).toBe(false);
  });
  it('refuses partial-credit marking instead of guessing', () => {
    const pc = parseExamMarking({ ...M, msq_partial_credit: true });
    expect(code(() => scoreAttempt(msq(), { kind: 'msq', selectedIndices: [0] }, pc))).toBe('MsqPartialCreditUnsupported');
  });
  it('refuses an item with no key', () => {
    expect(code(() => scoreAttempt({ id: 'x', kind: 'msq', marks: 2 }, { kind: 'msq', selectedIndices: [0] }, M))).toBe('InvalidItem');
  });
});

describe('NAT', () => {
  it.each([2.0, 1.995, 2.005, 1.995 - 5e-10, 2.005 + 5e-10])('%d is inside the range', (v) => {
    expect(scoreAttempt(nat(), { kind: 'nat', value: v }, M).correct).toBe(true);
  });
  it.each([3.0, 2.006, 1.995 - 2e-9])('%d is outside and earns 0', (v) => {
    expect(scoreAttempt(nat(), { kind: 'nat', value: v }, M)).toMatchObject({ correct: false, marks_awarded: 0 });
  });
  it('NaN and Infinity are NatParseError, not a wrong answer', () => {
    expect(code(() => scoreAttempt(nat(), { kind: 'nat', value: Number.NaN }, M))).toBe('NatParseError');
    expect(code(() => scoreAttempt(nat(), { kind: 'nat', value: Infinity }, M))).toBe('NatParseError');
  });
  it('refuses lo > hi', () => {
    expect(code(() => scoreAttempt(nat([2, 1]), { kind: 'nat', value: 1.5 }, M))).toBe('InvalidItem');
  });
});

describe('describeMarking', () => {
  it('shows the penalty before an attempt', () => {
    expect(describeMarking({ kind: 'mcq', marks: 1 }, M).marks_wrong).toBeCloseTo(-1 / 3, 12);
    expect(describeMarking({ kind: 'msq', marks: 2 }, M)).toEqual({ marks_correct: 2, marks_wrong: 0 });
    expect(describeMarking({ kind: 'nat', marks: 1 }, M)).toEqual({ marks_correct: 1, marks_wrong: 0 });
  });
});

describe('parseExamMarking', () => {
  it.each([
    [{}, 'mcq_negative'],
    [{ ...M, nat_epsilon: -1 }, 'nat_epsilon'],
    [{ ...M, mcq_negative_fallback_divisor: 0 }, 'divisor'],
    [{ ...M, msq_partial_credit: 'no' }, 'msq_partial_credit'],
  ])('refuses %j', (raw, field) => {
    expect(() => parseExamMarking(raw)).toThrow(field);
  });
});

describe('R10: invalid picks are refused, never scored', () => {
  const cases: [string, ScorableItem, Parameters<typeof scoreAttempt>[1]][] = [
    ['mcq index past the end', mcq(1), { kind: 'mcq', selectedIndex: 4 }],
    ['mcq index 7 on 4 options', mcq(1), { kind: 'mcq', selectedIndex: 7 }],
    ['mcq negative index', mcq(1), { kind: 'mcq', selectedIndex: -1 }],
    ['mcq fractional index', mcq(1), { kind: 'mcq', selectedIndex: 1.5 }],
    ['mcq NaN index', mcq(1), { kind: 'mcq', selectedIndex: Number.NaN }],
    ['msq index out of range', msq(), { kind: 'msq', selectedIndices: [0, 9] }],
    ['msq negative index', msq(), { kind: 'msq', selectedIndices: [-1, 2] }],
    ['msq fractional index', msq(), { kind: 'msq', selectedIndices: [0, 2.5] }],
    ['msq duplicate picks', msq(), { kind: 'msq', selectedIndices: [0, 0, 2] }],
    ['msq duplicate of the whole key', msq(), { kind: 'msq', selectedIndices: [2, 2] }],
  ];
  it.each(cases)('%s -> InvalidResponse', (_name, item, response) => {
    expect(code(() => scoreAttempt(item, response, M))).toBe('InvalidResponse');
  });
  it('the last valid index and a valid MSQ set still score', () => {
    expect(scoreAttempt(mcq(1), { kind: 'mcq', selectedIndex: 3 }, M).correct).toBe(false);
    expect(scoreAttempt(msq(), { kind: 'msq', selectedIndices: [2, 0] }, M).correct).toBe(true);
  });
  it('a skip is never refused', () => {
    expect(scoreAttempt(mcq(1), { kind: 'mcq', skipped: true }, M).skipped).toBe(true);
  });
});
