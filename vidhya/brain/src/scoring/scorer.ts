/**
 * B1 scorer. Ported from legacy `src/scoring/deterministic-scorer.ts`
 * (project-vidhya 0b26eb4b) with the same arithmetic, rules and refusals.
 *
 * What changed in the port, and why:
 *   - Marking numbers come from the pack's `exam.yaml` (`ExamMarking`), not
 *     from compiled constants. The scorer holds no exam defaults (Fork Test law).
 *   - Errors are named `BrainError`s instead of plain `Error`s (plan §7).
 *   - The output is the brain's own `Grade`, not legacy `GradeResult`.
 *
 * ONE INTENDED BEHAVIOUR CHANGE from the legacy scorer (plan R10, B1): an
 * MCQ index that is not an integer in [0, options.length), or MSQ indices that
 * are out of range, non-integer or duplicated, are refused with
 * `InvalidResponse` instead of being scored. The legacy scorer marked them
 * wrong and deducted marks. A refused pick is not an attempt; nothing is stored.
 *
 * Rules (unchanged):
 *   - MCQ correct → +marks; wrong → −penalty(marks); skipped → 0.
 *   - MSQ exact set → +marks; any other set → −msq_negative (often 0).
 *     `msq_partial_credit: true` is refused, never silently graded.
 *   - NAT inside [lo − ε, hi + ε] → +marks; otherwise −nat_negative (often 0).
 *   - Skipped → 0 for every kind.
 */
import { BrainError } from '../errors.js';
import type { ExamMarking } from '../exam/marking.js';

export type ItemKind = 'mcq' | 'msq' | 'nat';

export interface ScorableItem {
  id: string;
  kind: ItemKind;
  marks: number;
  /** MCQ: 0-based index of the correct option. */
  answerIndex?: number;
  /** MCQ + MSQ: the options (validation only). */
  options?: unknown[];
  /** MSQ: 0-based indices of every correct option. */
  answerIndices?: number[];
  /** NAT: inclusive accepted range. */
  answerRange?: [number, number];
}

export interface StudentResponse {
  kind: ItemKind;
  skipped?: boolean;
  selectedIndex?: number;
  selectedIndices?: number[];
  value?: number;
}

export interface Grade {
  correct: boolean;
  marks_awarded: number;
  max: number;
  skipped: boolean;
  feedback: string;
}

const SKIPPED = 'Skipped: no marks awarded or deducted.';

function grade(marks_awarded: number, max: number, correct: boolean, feedback: string, skipped = false): Grade {
  // Normalise -0 to 0 so a zero penalty never prints as "-0".
  return { correct, marks_awarded: marks_awarded === 0 ? 0 : marks_awarded, max, skipped, feedback };
}

/** Penalty magnitude for a wrong MCQ worth `itemMarks`. */
export function mcqPenalty(itemMarks: number, marking: ExamMarking): number {
  const listed = marking.mcq_negative[String(itemMarks)];
  if (typeof listed === 'number') return listed;
  return itemMarks / marking.mcq_negative_fallback_divisor;
}

export function scoreAttempt(item: ScorableItem, response: StudentResponse, marking: ExamMarking): Grade {
  if (item.kind !== response.kind) {
    throw new BrainError('InvalidResponse', `item kind "${item.kind}" does not match response kind "${response.kind}"`);
  }
  if (!(item.marks > 0)) throw new BrainError('InvalidItem', `item ${item.id} has no positive marks`);
  switch (item.kind) {
    case 'mcq':
      return scoreMcq(item, response, marking);
    case 'msq':
      return scoreMsq(item, response, marking);
    case 'nat':
      return scoreNat(item, response, marking);
  }
}

/** R10: a pick must be an integer in [0, optionCount). */
function assertValidPick(i: unknown, optionCount: number, what: string): asserts i is number {
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= optionCount) {
    throw new BrainError('InvalidResponse', `${what} must be an integer in [0, ${optionCount}), got ${String(i)}`);
  }
}

function scoreMcq(item: ScorableItem, r: StudentResponse, marking: ExamMarking): Grade {
  if (item.answerIndex === undefined || !item.options || item.options.length === 0) {
    throw new BrainError('InvalidItem', 'mcq item requires answerIndex and non-empty options');
  }
  const max = item.marks;
  if (r.skipped) return grade(0, max, false, SKIPPED, true);
  if (r.selectedIndex === undefined) {
    throw new BrainError('InvalidResponse', 'mcq response must set selectedIndex when not skipped');
  }
  assertValidPick(r.selectedIndex, item.options.length, 'mcq selectedIndex');
  const correct = r.selectedIndex === item.answerIndex;
  return grade(
    correct ? max : -mcqPenalty(max, marking),
    max,
    correct,
    correct ? 'Correct.' : 'Incorrect: negative marking applied.',
  );
}

function scoreMsq(item: ScorableItem, r: StudentResponse, marking: ExamMarking): Grade {
  if (!item.answerIndices || item.answerIndices.length === 0 || !item.options || item.options.length === 0) {
    throw new BrainError('InvalidItem', 'msq item requires non-empty answerIndices and options');
  }
  if (marking.msq_partial_credit) {
    throw new BrainError(
      'MsqPartialCreditUnsupported',
      'partial-credit MSQ grading is not implemented; confirm the official rule before enabling it',
    );
  }
  const max = item.marks;
  if (r.skipped) return grade(0, max, false, SKIPPED, true);
  if (!r.selectedIndices || r.selectedIndices.length === 0) {
    throw new BrainError('InvalidResponse', 'msq response must set selectedIndices when not skipped');
  }
  const picks = r.selectedIndices;
  const seen = new Set<number>();
  for (const i of picks) {
    assertValidPick(i, item.options.length, 'msq selectedIndices entry');
    if (seen.has(i)) throw new BrainError('InvalidResponse', `msq selectedIndices repeats index ${i}`);
    seen.add(i);
  }
  const want = new Set(item.answerIndices);
  const got = new Set(r.selectedIndices);
  const correct = want.size === got.size && [...want].every((i) => got.has(i));
  return grade(
    correct ? max : -marking.msq_negative,
    max,
    correct,
    correct ? 'Correct.' : 'Incorrect: MSQ needs exactly the correct set.',
  );
}

function scoreNat(item: ScorableItem, r: StudentResponse, marking: ExamMarking): Grade {
  if (!item.answerRange) throw new BrainError('InvalidItem', 'nat item requires answerRange');
  const [lo, hi] = item.answerRange;
  if (!(lo <= hi)) throw new BrainError('InvalidItem', `nat item ${item.id} has lo > hi`);
  const max = item.marks;
  if (r.skipped) return grade(0, max, false, SKIPPED, true);
  if (r.value === undefined || typeof r.value !== 'number' || !Number.isFinite(r.value)) {
    throw new BrainError('NatParseError', 'nat response must be a finite number when not skipped');
  }
  const eps = marking.nat_epsilon;
  const correct = r.value >= lo - eps && r.value <= hi + eps;
  return grade(
    correct ? max : -marking.nat_negative,
    max,
    correct,
    correct ? 'Correct.' : 'Incorrect: outside the accepted range.',
  );
}

/** What a client may show before an attempt: "+1 / −1/3". Never grades. */
export function describeMarking(item: Pick<ScorableItem, 'kind' | 'marks'>, marking: ExamMarking) {
  const wrong =
    item.kind === 'mcq' ? -mcqPenalty(item.marks, marking) : item.kind === 'msq' ? -marking.msq_negative : -marking.nat_negative;
  return { marks_correct: item.marks, marks_wrong: wrong === 0 ? 0 : wrong };
}
