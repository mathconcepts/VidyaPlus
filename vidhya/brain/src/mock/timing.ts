/**
 * Mock timing, read from a pack's exam config (plan B5: "180 min / 100 marks
 * x form marks" is the shape; the numbers arrive as data, never as constants).
 */
import { BrainError } from '../errors.js';

export interface ExamTiming {
  /** Whole-paper duration in minutes. */
  total_minutes: number;
  /** Whole-paper marks. */
  total_marks: number;
}

export function parseExamTiming(raw: unknown): ExamTiming {
  if (!raw || typeof raw !== 'object') throw new BrainError('InvalidMockForm', 'timing block missing');
  const o = raw as Record<string, unknown>;
  for (const k of ['total_minutes', 'total_marks'] as const) {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new BrainError('InvalidMockForm', `timing.${k} must be a finite number > 0`);
    }
  }
  return { total_minutes: o.total_minutes as number, total_marks: o.total_marks as number };
}

/** Pace-proportional minutes for a form worth `formMarks`, rounded UP to a whole minute. */
export function formMinutes(timing: ExamTiming, formMarks: number): number {
  if (!(formMarks > 0)) throw new BrainError('InvalidMockForm', 'a form needs positive total marks');
  return Math.max(1, Math.ceil((timing.total_minutes / timing.total_marks) * formMarks - 1e-9));
}
