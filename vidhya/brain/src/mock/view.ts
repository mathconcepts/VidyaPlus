/**
 * The two student-facing result shapes (R15, DR11, DR6, DR18).
 *
 *   before close: ONLY score, max marks, right/wrong/skipped, the label, the unlock date.
 *   after close:  the review: per-item answer, key, solution, receipt.
 */
import { BrainError } from '../errors.js';
import type { Item } from '../item/schema.js';
import type { StudentResponse } from '../scoring/scorer.js';
import { computeOutcomes, totals } from './score.js';
import { settleIfDue } from './settle.js';
import { getForm, isFinished, isPractice, loadOwned, type Db, type MockContext } from './rows.js';

export const LABEL_SCORED = 'unproctored practice mock';
export const LABEL_PRACTICE = 'practice mock · unscored';

export interface PreCloseResult {
  revealed: false;
  label: string;
  score: number;
  max_marks: number;
  counts: { right: number; wrong: number; skipped: number };
  /** The planned cohort close date (YYYY-MM-DD), or null until Giri sets one. */
  unlock_date: string | null;
}

export interface ReviewItem {
  item_id: string;
  state: 'counted' | 'withdrawn';
  stem: string | null;
  options: string[] | null;
  your_answer: StudentResponse | null;
  key: Item['key'] | null;
  solution: string | null;
  receipt: unknown;
  correct: boolean;
  marks_awarded: number;
  marks_max: number;
}

export interface PostCloseResult extends Omit<PreCloseResult, 'revealed'> {
  revealed: true;
  mode: 'scored' | 'practice';
  /** Items voided or withdrawn; they count on neither side of the marks. */
  withdrawn_count: number;
  review: ReviewItem[];
}

export type ResultView = PreCloseResult | PostCloseResult;

/** The student-facing result. Only a closed form reveals anything beyond the tally. */
export function resultView(db: Db, ctx: MockContext, student: string, attemptId: number, now: Date): ResultView {
  const row0 = loadOwned(db, student, attemptId);
  const row = settleIfDue(db, ctx, row0, now);
  if (!isFinished(row)) throw new BrainError('MockNotSubmitted', 'submit the mock (or wait for the timer) before asking for a result');
  const form = getForm(db, row.form_version);
  const outcomes = computeOutcomes(db, ctx, row);
  const t = totals(outcomes);
  const practice = isPractice(row);
  const head = {
    label: practice ? LABEL_PRACTICE : LABEL_SCORED,
    score: t.score,
    max_marks: t.max_marks,
    counts: { right: t.right, wrong: t.wrong, skipped: t.skipped },
    unlock_date: form.planned_close,
  };
  if (!form.closed_at) return { revealed: false, ...head };
  const review = outcomes.map((o): ReviewItem => {
    const item = ctx.resolveItem(o.item_id);
    return {
      item_id: o.item_id,
      state: o.state,
      stem: item?.stem ?? null,
      options: item?.options ? [...item.options] : null,
      your_answer: o.response,
      key: item?.key ?? null,
      solution: item?.solution.text ?? null,
      receipt: item?.receipt ?? null,
      correct: o.correct,
      marks_awarded: o.awarded,
      marks_max: o.max,
    };
  });
  return { revealed: true, mode: practice ? 'practice' : 'scored', withdrawn_count: t.withdrawn, review, ...head };
}
